// Clawd Wander: Claude が作業している間、プロンプトのすぐ上の帯で Clawd がうろうろする。
// サブエージェントが動いている間は、1 体ごとに色も種類も違う仲間が増える。
//
// ui.render (AbovePrompt): 本体が作業中（isWorking）か、サブエージェントが動いているか、
//   誰かが消えかけている間だけ、帯の最下行に Raster を 1 つ描く。
//   ほかの mod が帯に描いたものは next(e) で受け取り、上に残す。
// agent.spawn: サブエージェントが起動したら、帯のランダムな位置に仲間を 1 体増やす。
// タイマー: 描いている間 TICK_MS ごとに全員を 1 コマ進め、$.ui.blit で Raster だけを書き換える。
//   POLL_TICKS コマごとに $.agent.list() で顔ぶれを揃え、終わったエージェントを消し始める。
//   全員が消えきったら帯を描き直させ、描くものが無ければ次のコマで止まる。
//   止めるのは帯が「描くものなし」と言ったときだけ。blit が通らない状態が続いたら
//   止めずに帯を描き直させ、作り直された帯で続ける。
// 見張り（keepAlive）: タイマーは黙って終わることがある（$.clock.every は 1 回拒否されると終わる）。
//   タイマーは 1 秒ごとに鼓動（lastBeat）を残す。帯の描き直しとツール呼び出しのたびに、
//   鼓動が STALL_MS 途絶えていればタイマーを張り直す。
// Raster はターミナルにしかないので、ほかの画面では何も描かない。
//
// エンジンは on(...) と $.noun.method(...) をソースから読むので、$ を受け取る
// ヘルパーはファイルの最上位に関数宣言で置く。

import type { AgentInfo, AgentStatus, EngineInterface, Register } from 'claude-code'

import { actors, advance, assemble, type Crew, isVisible, join, setMain, sync } from './crew'
import { WIDEST } from './mascots'
import { paint, SPRITE_ROWS } from './sprite'

const KEY = 'clawd'
const TICK_MS = 100
/** 何コマごとにエージェントの一覧を見直すか（10 コマ = 1 秒） */
const POLL_TICKS = 10
/** blit がこの回数続けて通らなければ、帯が作り直されたとみなして描き直させる */
const MAX_MISSES = 10
/** 鼓動がこの時間途絶えたら、タイマーが終わったとみなして張り直す */
const STALL_MS = 2000
/** 「動いている」とみなすエージェントの状態。idle と終了済みは数えない */
const ACTIVE: ReadonlySet<AgentStatus> = new Set(['pending', 'running', 'waiting'])

/** いま Clawd を描いている帯。描いていなければ null */
type Stage = { requestId: string; columns: number }

let crew: Crew = assemble()
let stage: Stage | null = null
let timer: { cancel: () => void } | null = null
let misses = 0
let ticks = 0
/** タイマーが最後に鼓動した時刻（POLL_TICKS コマごとに残す） */
let lastBeat = 0
/** 最後に描いた帯の幅（ピクセル）。新しい仲間の出現位置を決めるのに使う */
let lastCanvas = 0

export const register: Register = on => {
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (result.agentId !== undefined) {
      crew = join(crew, result.agentId, Math.random, lastCanvas)
      $.ui.invalidate('ui.render')
    }
    return result
  })

  // 見張りのきっかけ。ツールの呼び出しには手を出さない
  on('tool.call', ($, e, next) => {
    keepAlive($).catch(() => undefined)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const ui = $.ui.resolve(e)
    const { isWorking, hasSurvey, bodyColumns } = e.props
    crew = setMain(crew, isWorking)
    if (!isVisible(crew) || hasSurvey || !('Raster' in ui) || bodyColumns * 2 < WIDEST) {
      stage = null
      return next(e)
    }

    stage = { requestId: e.requestId, columns: bodyColumns }
    lastCanvas = bodyColumns * 2
    await keepAlive($)

    const { Box, Raster } = ui
    // 帯の最下行に置く。帯と入力欄の間の空き行は帯の外で、absolute でずらしても切り取られる（2026-10-06 に実測）
    const clawd = Raster({ key: KEY, columns: bodyColumns, rows: SPRITE_ROWS, cells: frame(stage) })
    const theirs = await next(e)
    return Box({ flexDirection: 'column', children: theirs ? [theirs, clawd] : [clawd] })
  })
}

function tick($: EngineInterface) {
  if (stage === null) {
    stop()
    return
  }
  ticks += 1
  if (ticks % POLL_TICKS === 0) {
    $.clock.now().then(
      now => {
        lastBeat = now
      },
      () => undefined,
    )
    $.agent.list().then(
      list => refresh($, list),
      () => undefined,
    )
  }
  crew = advance(crew, stage.columns * 2, Math.random)
  if (!isVisible(crew)) {
    // 最後の 1 体が消えきった。帯を描き直させ、描くものが無ければ次のコマで止まる
    $.ui.invalidate('ui.render')
  }
  $.ui
    .blit({
      requestId: stage.requestId,
      key: KEY,
      columns: stage.columns,
      rows: SPRITE_ROWS,
      cells: frame(stage),
    })
    .then(
      result => missed($, result.deny !== undefined),
      () => missed($, true),
    )
}

/**
 * タイマーが生きているか確かめ、終わっていたら張り直す。描くものが無ければ何もしない。
 * 鼓動が STALL_MS 途絶えていたら、終わったとみなす。
 */
async function keepAlive($: EngineInterface) {
  if (stage === null) return
  const now = await $.clock.now()
  if (timer !== null && now - lastBeat >= STALL_MS) {
    timer.cancel()
    timer = null
  }
  if (timer === null) {
    lastBeat = now
    timer = $.clock.every(TICK_MS, () => tick($))
  }
}

/** エージェントの一覧に顔ぶれを揃える。描く・描かないが変わるなら帯を描き直す */
function refresh($: EngineInterface, list: readonly AgentInfo[]) {
  const wasVisible = isVisible(crew)
  crew = sync(
    crew,
    list.filter(agent => ACTIVE.has(agent.status)).map(agent => agent.id),
    Math.random,
    lastCanvas,
  )
  if (isVisible(crew) !== wasVisible) {
    $.ui.invalidate('ui.render')
  }
}

function frame(at: Stage) {
  return paint(actors(crew), at.columns)
}

/** blit が通らない状態が続いたら、止めずに帯を描き直させる（作り直された帯に新しく描く） */
function missed($: EngineInterface, isMiss: boolean) {
  misses = isMiss ? misses + 1 : 0
  if (misses >= MAX_MISSES) {
    misses = 0
    $.ui.invalidate('ui.render')
  }
}

function stop() {
  timer?.cancel()
  timer = null
  stage = null
  misses = 0
}
