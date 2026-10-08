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
// tool.call: 呼び出し元の 1 体に活動を知らせる（居眠りから起き、失敗なら驚き、テストが通れば紙吹雪。呼び出しが動いている間は眠らない）。
//   編集系のツールならハンマー、調べる系なら虫めがね、Write は鉛筆、Agent は旗、待ちを始めるツールは砂時計、
//   テストを走らせる Bash はフラスコを、使っている間と使い終えてから 10 秒（/config で変えられる）持たせる。
//   持ち替えてから 1.5 秒は次の道具に替えない（.scratch/props/spec.md）。紙吹雪は .scratch/cheer/spec.md。
// session.compact: 会話の圧縮の間、そのループのマスコットをぺしゃんこにする（.scratch/squash/spec.md）。
// 行列: タイマーの 1 コマごとに、ときどき仲間が本体のあとを一列についていく（.scratch/parade/spec.md）。
// ひとり遊び: 本体がひとりのときは、ときどき波乗り・小踊り・蝶々のどれかをする（.scratch/play/spec.md）。
// Raster はターミナルにしかないので、ほかの画面では何も描かない。
//
// エンジンは on(...) と $.noun.method(...) をソースから読むので、$ を受け取る
// ヘルパーはファイルの最上位に関数宣言で置く。

import type { AgentInfo, AgentStatus, EngineInterface, Register } from 'claude-code'

import {
  actors,
  advance,
  assemble,
  celebrate,
  type Crew,
  disengage,
  engage,
  isVisible,
  join,
  lineUp,
  MAIN,
  poke,
  release,
  setMain,
  squeeze,
  startPlay,
  sync,
  type Timing,
  timingOf,
  unsqueeze,
  wantsMain,
  wield,
} from './crew'
import { propFor } from './props'
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
/** 最後に受け取った「Claude が作業中か」。仲間の一覧を見直したときに本体の出入りを決めるのに使う */
let lastWorking = false
/** 最後に描いた帯の幅（ピクセル）。新しい仲間の出現位置を決めるのに使う */
let lastCanvas = 0
/** /config で決めた居眠り・道具の時間（.scratch/config/spec.md）。設定が変わるとモジュールごと読み直される */
let timing: Timing = timingOf({})
/** /config でひとり遊びを止めていなければ true（.scratch/play/spec.md の R5） */
let plays = true

export const register: Register = (on, options) => {
  timing = timingOf(options)
  plays = options.play !== false
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (result.agentId !== undefined) {
      crew = join(crew, result.agentId, Math.random, lastCanvas, timing)
      $.ui.invalidate('ui.render')
    }
    return result
  })

  // 見張りのきっかけと、呼び出し元への活動の知らせ。ツールの呼び出しそのものには手を出さない
  on('tool.call', async ($, e, next) => {
    keepAlive($).catch(() => undefined)
    const id = e.agentId ?? MAIN
    // Bash はコマンドの中身で道具を決める（テストを走らせるならフラスコ。props の R20）
    const command = e.tool === 'Bash' ? e.command : undefined
    crew = engage(wield(poke(crew, id, false), id, e.tool, command, timing), id)
    // 1 つの呼び出しは 1 回だけ使い終える。中断されたらその時点で（props の R16）、例外で抜けても（R13）
    let ended = false
    const end = () => {
      if (ended) return
      ended = true
      crew = disengage(release(crew, id, e.tool, command, timing), id)
    }
    next.signal.addEventListener('abort', end, { once: true })
    // 付けた時点で中断済みなら、abort はもう届かない
    if (next.signal.aborted) end()
    try {
      const result = await next(e)
      const failed = result.deny !== undefined || result.isError === true
      crew = poke(crew, id, failed)
      // cheer の R1・R3: テストを走らせる Bash が成功したら、紙吹雪を降らせる
      if (!failed && propFor(e.tool, command) === 'flask') crew = celebrate(crew, id)
      return result
    } finally {
      end()
    }
  })

  // squash の R1・R3: 会話の圧縮の間、そのループのマスコットを押しつぶし、終わったら（取りやめ・例外でも）戻す。
  // precompute は前もって計算するだけで会話は変わらないので、何もしない
  on('session.compact', async ($, e, next) => {
    if (e.trigger === 'precompute') return next(e)
    const id = e.agentId ?? MAIN
    crew = squeeze(crew, id)
    try {
      return await next(e)
    } finally {
      crew = unsqueeze(crew, id)
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const ui = $.ui.resolve(e)
    const { isWorking, hasSurvey, bodyColumns } = e.props
    lastWorking = isWorking
    // 本体は、Claude が作業中か、サブエージェントが動いているか、圧縮でつぶれている・戻っている間だけ出す（.scratch/always/spec.md・.scratch/squash/spec.md の R7）
    crew = setMain(crew, wantsMain(crew, isWorking))
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
  const canvas = stage.columns * 2
  const lined = lineUp(crew, Math.random, canvas, timing)
  crew = advance(plays ? startPlay(lined, Math.random, canvas, timing) : lined, canvas, Math.random, timing)
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
    timing,
  )
  // 仲間がいなくなって Claude も作業しておらず、つぶれても戻ってもいなければ、本体も消え始める
  crew = setMain(crew, wantsMain(crew, lastWorking))
  if (isVisible(crew) !== wasVisible) {
    $.ui.invalidate('ui.render')
  }
}

function frame(at: Stage) {
  return paint(actors(crew, timing), at.columns)
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
