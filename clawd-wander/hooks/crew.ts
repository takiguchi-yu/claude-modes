// 帯を歩く顔ぶれ。本体の Clawd 1 体と、動いているサブエージェント 1 体ごとの仲間。
//
// エージェントの一覧に合わせて増減させ、絵と色を割り当て、全員を 1 コマずつ進める。
// 新しく来た仲間は、まだいない種類の絵でランダムな位置に現れる。
// 現れるときは上から降りながら、いなくなるときは浮き上がりながら、その場でふわっと出入りする
// （出入りの状態遷移は presence.ts）。現れかけ・消えかけの間は歩かない。
// ツールの呼び出し（poke）が途切れると居眠りし、失敗すると驚く。呼び出しが動いている間（engage〜disengage）は眠らない（.scratch/emotes/spec.md）。
// ツールを使っている間と、使い終えてからしばらく、そのツールの道具を持つ（wield・release。.scratch/props/spec.md）。
// ときどき仲間が本体のあとを一列についていく（lineUp。.scratch/parade/spec.md）。
// 本体がひとりのときは、ときどきひとり遊び（波乗り・蝶々）をする（startPlay・playStep。.scratch/play/spec.md）。
// テストが通ると紙吹雪を降らせ（celebrate。.scratch/cheer/spec.md）、会話の圧縮の間はぺしゃんこになる（squeeze・unsqueeze。.scratch/squash/spec.md）。
// 先頭は常に本体（MAIN）。本体は消えても顔ぶれに残り、次に作業が始まると同じ場所に戻る。
// Claude Code の API は知らない。

import { FRIENDS, type MascotId, MASCOTS } from './mascots'
import { begin, type Heading, type Parade, record, slot } from './parade'
import { appear, elapse, GONE, look, type Presence, retreat } from './presence'
import { decay, grab, type Grip, PROP_FRAMES, propFor, type PropId, reach, relax } from './props'
import { type Actor, type Emote, emoteReach, ORANGE } from './sprite'
import { catchWave, ebb, fadeOf, recede, SURF_PACE } from './surf'
import { flutter, GAP, launch, scare, WIDTH as BUTTERFLY_WIDTH } from './butterfly'
import { type Play, PLAY_CHANCE, type PlayKind, playable } from './play'
import { CHEER_FRAMES } from './cheer'
import { liftOf, PRESSED, settle, type Squash, unpress } from './squash'
import { poseOf, start, step, type Wanderer } from './wander'

export const MAIN = 'main'
/** 帯に並べるサブエージェントの上限。これを超えた分は描かない */
export const MAX_AGENTS = 8

/** サブエージェントの色。本体の橙と見分けやすいものを順に使う */
const AGENT_COLORS = [0x6a9bcc, 0x788c5d, 0xb48ead, 0xd8a657, 0x5fb3b3, 0xc97b8b, 0x9a8fd1, 0xa3be8c]

export type Member = {
  readonly id: string
  readonly mascot: MascotId
  readonly color: number
  readonly wanderer: Wanderer
  /** 出入りの状態。'gone' のまま顔ぶれに残るのは本体だけ */
  readonly presence: Presence
  /** 最後の活動（ツールの呼び出し）からのコマ数。いる間で、動いている呼び出しが無いときだけ数える */
  readonly idle: number
  /** 動いているツールの呼び出しの数（どのツールでも。emotes の R12） */
  readonly busy: number
  /** 驚きの残りコマ数。0 なら驚いていない */
  readonly startle: number
  /** 手に持っている道具。持っていなければ null（.scratch/props/spec.md） */
  readonly prop: Grip | null
  /** 率いている行列。本体だけが持ち、仲間は常に null（.scratch/parade/spec.md） */
  readonly parade: Parade | null
  /** ひとり遊び（波乗り・小踊り・蝶々）。本体だけが持ち、仲間は常に null（.scratch/play/spec.md） */
  readonly play: Play | null
  /** 紙吹雪の残りコマ数。0 なら降っていない（.scratch/cheer/spec.md） */
  readonly cheer: number
  /** 会話の圧縮で押しつぶされている・戻っている。null ならふつう（.scratch/squash/spec.md） */
  readonly squash: Squash | null
}

/** 活動がこのコマ数途切れたら居眠りする（既定 60 秒） */
export const DOZE_FRAMES = 600

/**
 * /config で変えられる時間（コマ数）。`dozeFrames` は居眠りするまで、`propFrames` は道具を使い終えてからしまうまで
 * （.scratch/config/spec.md）。居眠りと道具を決める関数が最後の引数で受け取る
 */
export type Timing = { readonly dozeFrames: number; readonly propFrames: number }
export const DEFAULT_TIMING: Timing = { dozeFrames: DOZE_FRAMES, propFrames: PROP_FRAMES }

/** 1 コマのミリ秒 */
const FRAME_MS = 100

/**
 * プラグインの設定（/config）の doze_seconds・prop_seconds をコマ数にした Timing。
 * 1 以上 3600 以下の数でなければ、その項目は既定値にする（.scratch/config/spec.md の R3）
 */
export function timingOf(options: Readonly<Record<string, unknown>>): Timing {
  const frames = (key: string, fallback: number) => {
    const seconds = options[key]
    return typeof seconds === 'number' && seconds >= 1 && seconds <= 3600 ? Math.round((seconds * 1000) / FRAME_MS) : fallback
  }
  return { dozeFrames: frames('doze_seconds', DOZE_FRAMES), propFrames: frames('prop_seconds', PROP_FRAMES) }
}
/** 驚いているコマ数（2 秒）。最初の SHAKE_FRAMES コマだけ震える */
export const STARTLE_FRAMES = 20
const SHAKE_FRAMES = 8
/** 居眠りの z を何コマごとに上下させるか */
const Z_EVERY = 5
/** 行列を始める確率（1 コマあたり）と、続けるコマ数の範囲 */
export const PARADE_CHANCE = 1 / 150
const PARADE_FRAMES = { min: 80, max: 150 }
/**
 * 行列で前の 1 体との間に空けるピクセル数と、仲間が 1 コマに進めるピクセル数（本体は 1 ピクセル）。
 * 道具を持つ仲間の前は、さらに道具の張り出しを空ける（spacing）
 */
const PARADE_GAP = 2
const FOLLOW_PACE = 4
/** ひとり遊びを終えたあと、本体が立ち止まるコマ数の範囲（play の R6） */
const PLAY_PAUSE = { min: 5, max: 15 }
/** 蝶々を追うとき、本体が 1 コマに進めるピクセル数（butterfly の R3） */
const CHASE_PACE = 3
/** 行列が終わったあと、仲間が立ち止まるコマ数の範囲 */
const PARADE_PAUSE = { min: 5, max: 15 }

export type Crew = readonly Member[]

export const assemble = (): Crew => [
  { id: MAIN, mascot: 'clawd', color: ORANGE, wanderer: start(), presence: GONE, idle: 0, busy: 0, startle: 0, prop: null, parade: null, play: null, cheer: 0, squash: null },
]

/** 消えかけも含めて、いまいるサブエージェントの数 */
export const agentCount = (crew: Crew): number => crew.length - 1

/** サブエージェントの仲間が動いているか（現れかけ・いる。消えかけは含まない。.scratch/always/spec.md R1） */
export const hasFriends = (crew: Crew): boolean =>
  crew.slice(1).some(m => m.presence.kind === 'arriving' || m.presence.kind === 'here')

/**
 * 本体を出すか（.scratch/always/spec.md の R1）。作業中か、仲間が動いているか、本体が押しつぶされている・戻っている
 * （.scratch/squash/spec.md の R7。`/compact` は圧縮と作業が同時に終わるので、戻ってから消えるように）なら出す
 */
export const wantsMain = (crew: Crew, isWorking: boolean): boolean => isWorking || hasFriends(crew) || (crew[0]?.squash ?? null) !== null

/** 帯に描くものが 1 体でも残っているか（現れかけ・消えかけを含む） */
export const isVisible = (crew: Crew): boolean => crew.some(m => m.presence.kind !== 'gone')

const shown = (m: Member): Member => ({ ...m, presence: appear(m.presence) })
const hidden = (m: Member): Member => {
  // props の R14・emotes の R13: 現れかけたばかりで引っ込めると、その場で消えきる。そのときは道具をしまい、呼び出しも数え直す
  const presence = retreat(m.presence)
  return presence.kind === 'gone' ? { ...m, presence, prop: null, busy: 0 } : { ...m, presence }
}

/** 置ける x の最大（ピクセル）。帯の幅 `canvas` から絵の幅を引いたもの */
const roomFor = (mascot: MascotId, canvas: number) => Math.max(0, canvas - MASCOTS[mascot].width)

/** min 以上 max 以下の整数を乱数で選ぶ */
const between = (random: () => number, min: number, max: number) => min + Math.floor(random() * (max - min + 1))

/** 歩けるか: いる・驚いていない・居眠りしていない（デシジョンテーブル T4） */
// squash の R2・R4: 押しつぶされている・戻っている間も歩かない
const canWalk = (m: Member, timing: Timing) =>
  m.presence.kind === 'here' && m.startle === 0 && m.idle < timing.dozeFrames && m.squash === null

/** 出している記号の種類。驚きが居眠りより先（actors と同じ）。出入りの途中・記号なしは null */
const emoteOf = (m: Member, timing: Timing): Emote['kind'] | null =>
  look(m.presence) !== null || m.squash?.kind === 'pressed'
    ? null
    : m.startle > 0
      ? 'startle'
      : m.idle >= timing.dozeFrames
        ? 'doze'
        : null

/** 0〜1 の乱数で配列から 1 つ選ぶ */
const choose = <T>(items: readonly T[], random: () => number): T =>
  items[Math.min(items.length - 1, Math.floor(random() * items.length))]!

/** 本体の出入り。作業が始まればその場に現れ、終われば消えていく */
export function setMain(crew: Crew, isWorking: boolean): Crew {
  const [main = assemble()[0]!, ...agents] = crew
  return [isWorking ? shown(main) : hidden(main), ...agents]
}

/**
 * 動いているサブエージェントの id に合わせて顔ぶれを揃える。`canvas` は帯の幅（ピクセル）。
 * 新しく来た仲間は、まだいない種類の絵（全種類いればどれでも）で、ランダムな位置に現れる。
 * 一覧から外れたエージェントは消え始め、消えかけのうちに戻ってきたら消えるのをやめる。
 */
export function sync(
  crew: Crew,
  agentIds: readonly string[],
  random: () => number,
  canvas: number,
  timing: Timing = DEFAULT_TIMING,
): Crew {
  const [main = assemble()[0]!, ...agents] = crew
  const wanted = [...new Set(agentIds)].slice(0, MAX_AGENTS)
  // 現れかけたばかり（濃さ 0）で引っ込めると、その場でいなくなるので外す
  const kept = agents
    .map(m => (wanted.includes(m.id) ? shown(m) : hidden(m)))
    .filter(m => m.presence.kind !== 'gone')
  const usedColors = new Set(kept.map(m => m.color))
  const usedMascots = new Set(kept.map(m => m.mascot))
  const added: Member[] = []
  for (const id of wanted) {
    if (kept.some(m => m.id === id)) continue
    const fresh = FRIENDS.filter(f => !usedMascots.has(f))
    const mascot = choose(fresh.length > 0 ? fresh : FRIENDS, random)
    const color = AGENT_COLORS.find(c => !usedColors.has(c)) ?? AGENT_COLORS[usedColors.size % AGENT_COLORS.length]!
    usedMascots.add(mascot)
    usedColors.add(color)
    const x = Math.floor(random() * (roomFor(mascot, canvas) + 1))
    added.push(shown({ id, mascot, color, wanderer: { ...start(), x }, presence: GONE, idle: 0, busy: 0, startle: 0, prop: null, parade: null, play: null, cheer: 0, squash: null }))
  }
  // parade-rejoin の R8: 行列の間に来た仲間は、最後尾に続く歩けない仲間より前に入れる
  let at = kept.length
  if (main.parade !== null) while (at > 0 && !canWalk(kept[at - 1]!, timing)) at -= 1
  return [main, ...kept.slice(0, at), ...added, ...kept.slice(at)]
}

/**
 * サブエージェントが 1 体起動した。ほかの顔ぶれはそのまま。
 * sync は一覧に無い者を外さず消し始めるだけなので、消えかけの者は消えかけのまま残る。
 */
export function join(crew: Crew, id: string, random: () => number, canvas: number, timing: Timing = DEFAULT_TIMING): Crew {
  const present = crew
    .slice(1)
    .filter(m => m.presence.kind === 'arriving' || m.presence.kind === 'here')
    .map(m => m.id)
  return sync(crew, [...present, id], random, canvas, timing)
}

/**
 * 全員を 1 コマ進める。`canvas` は帯の幅（ピクセル）。
 * いる者だけが歩き、現れかけ・消えかけの者はその場で止まって残りコマを減らす。
 * 消えきった仲間は外す。本体は外さない。
 */
export function advance(crew: Crew, canvas: number, random: () => number, timing: Timing = DEFAULT_TIMING): Crew {
  const marching = crew[0]?.parade != null
  const next = crew.map(m => {
    const isHere = m.presence.kind === 'here'
    // デシジョンテーブル T2〜T4: 驚いている・居眠りしている間は歩かない。
    // 行列の間は本体も仲間も自分では歩かず、march で進む
    // play: ひとり遊びの間は自分では歩かず、playStep で動く
    const walks = canWalk(m, timing) && !marching && m.play === null
    const presence = elapse(m.presence)
    return {
      ...m,
      wanderer: walks ? step(m.wanderer, roomFor(m.mascot, canvas), random) : m.wanderer,
      presence,
      // emotes の R11: 呼び出しが動いている間は途切れを数えない（眠らない）
      idle: isHere && m.busy === 0 ? m.idle + 1 : 0,
      startle: Math.max(0, m.startle - 1),
      // props の R14・emotes の R13: 消えきったら、使っている呼び出しが残っていても道具をしまい、呼び出しも数え直す
      prop: presence.kind === 'gone' ? null : decay(m.prop),
      busy: presence.kind === 'gone' ? 0 : m.busy,
      cheer: Math.max(0, m.cheer - 1),
      // squash の R5: 引っ込められたら（跳ねる・消えかけ）押しつぶしをやめる。消えきっている・現れかけの間は続け、戻りを 1 コマ進める
      squash: presence.kind === 'leaping' || presence.kind === 'leaving' ? null : settle(m.squash),
    }
  })
  const kept = next.filter(m => m.id === MAIN || m.presence.kind !== 'gone')
  const [main, ...friends] = kept
  if (main === undefined) return kept
  if (main.play !== null) return [playStep(main, friends.length > 0, canvas, random, timing), ...friends]
  return marching ? march(kept, canvas, random, timing) : kept
}

/** 帯の広いほう（同じなら右）。本体が x にいて、置ける x の最大が room のとき */
const widerSide = (x: number, room: number): Heading => (room - x >= x ? 'right' : 'left')

/**
 * ひとりで歩ける本体が、行列もひとり遊びもしていないコマに、始められる遊びがあれば、PLAY_CHANCE の確率で、
 * 始められる遊びから 1 つを乱数で選んで始める（.scratch/play/spec.md の R1・R2・T2〜T7）。条件を満たさないときは random を呼ばない。
 * 設定でひとり遊びが止められている（T1）なら、呼び出し元が呼ばない。`canvas` は帯の幅（ピクセル）
 */
export function startPlay(crew: Crew, random: () => number, canvas: number, timing: Timing = DEFAULT_TIMING): Crew {
  const [main, ...friends] = crew
  if (main === undefined || friends.length > 0 || !canWalk(main, timing) || main.parade !== null || main.play !== null) return crew
  const kinds = playable(main.wanderer.x, roomFor(main.mascot, canvas))
  if (kinds.length === 0) return crew
  if (random() >= PLAY_CHANCE) return crew
  const kind = kinds[Math.min(kinds.length - 1, Math.floor(random() * kinds.length))]!
  return beginPlay(crew, kind, canvas)
}

/** 本体に遊び `kind` を始めさせる（各遊びの仕様の始め方）。`canvas` は帯の幅（ピクセル） */
export function beginPlay(crew: Crew, kind: PlayKind, canvas: number): Crew {
  const [main, ...rest] = crew
  if (main === undefined) return crew
  const x = main.wanderer.x
  const heading = widerSide(x, roomFor(main.mascot, canvas))
  const front = heading === 'right' ? x + MASCOTS[main.mascot].width : x
  const play: Play = kind === 'surf' ? { kind, ...catchWave(heading) } : { kind, ...launch(front, heading) }
  // 波乗り・蝶々は向かう側を向く
  return [{ ...main, wanderer: { ...main.wanderer, facing: heading }, play }, ...rest]
}

/** ひとり遊びを終え、少し立ち止まってから歩き出す（play の R6） */
const settleDown = (main: Member, random: () => number): Member => ({
  ...main,
  play: null,
  wanderer: { ...main.wanderer, mode: 'pause', left: between(random, PLAY_PAUSE.min, PLAY_PAUSE.max) },
})

/**
 * ひとり遊びをしている本体を 1 コマ進める（.scratch/play/spec.md）。`crowded` は仲間が顔ぶれにいるか。
 * 歩けなくなった・引っ込められたら、どの遊びもその場でやめる（R4）。それ以外は遊びごとに進める
 */
function playStep(main: Member, crowded: boolean, canvas: number, random: () => number, timing: Timing): Member {
  const play = main.play!
  if (!canWalk(main, timing)) return { ...main, play: null }
  switch (play.kind) {
    case 'surf':
      return ride(main, play, crowded, canvas, random)
    case 'butterfly':
      return chase(main, play, crowded, canvas, random)
  }
}

/**
 * 波乗りしている本体を 1 コマ進める（surf の R2〜R6・S4〜S9）。
 * 乗っている間は向かう側へ SURF_PACE ピクセル進み、次で端を越えるならその場で止まって波を引かせる。引ききったら板から降りる
 */
function ride(main: Member, surf: Extract<Play, { kind: 'surf' }>, crowded: boolean, canvas: number, random: () => number): Member {
  // R6・S6: 乗っている間に仲間が加わったら、その場で止まって引かせ始める（引いている間はそのまま。S9）
  if (crowded && surf.ebb === null) return { ...main, play: { ...surf, ...ebb(surf) } }
  if (surf.ebb === null) {
    const next = main.wanderer.x + (surf.heading === 'right' ? SURF_PACE : -SURF_PACE)
    // R3・S5: 次で端を越えるなら、その場で止まって引かせる
    if (next < 0 || next > roomFor(main.mascot, canvas)) return { ...main, play: { ...surf, ...ebb(surf) } }
    // R2・S4: 向かう側へ進み、その向きを向く
    return { ...main, wanderer: { ...main.wanderer, x: next, facing: surf.heading, mode: 'walk', left: 1 } }
  }
  const after = recede(surf)
  // R5・S8: 引ききったら板から降り、少し立ち止まってから歩き出す
  return after === null ? settleDown(main, random) : { ...main, play: { kind: 'surf', ...after } }
}

/**
 * 蝶々を追いかけている本体を 1 コマ進める（butterfly の R2〜R6・R9）。
 * 蝶々が飛んでいる間は、前の端が蝶々の GAP 手前（蝶々の進む向きの後ろ側）に来る位置へ 1 コマ CHASE_PACE ピクセルまで追う。
 * 蝶々が端で折り返すと、本体の上を通って反対側へ飛ぶので、本体は進んだ向きを向いて追う。
 * 飛び去っている・見送っている間は止まる。見送り終えたら終わる
 */
function chase(main: Member, b: Extract<Play, { kind: 'butterfly' }>, crowded: boolean, canvas: number, random: () => number): Member {
  // R6・S3: 仲間が加わったら飛び去らせる（このコマは向きを変えるだけで、次のコマから昇る）
  if (crowded && b.phase === 'fly') {
    return { ...main, play: { kind: 'butterfly', ...scare(b) }, wanderer: { ...main.wanderer, facing: 'front', mode: 'pause', left: 1 } }
  }
  const next = flutter(b, canvas)
  if (next === null) return settleDown(main, random)
  const play: Play = { kind: 'butterfly', ...next }
  if (next.phase !== 'fly') {
    // R5: 止まって正面を向き、見送る
    return { ...main, play, wanderer: { ...main.wanderer, facing: 'front', mode: 'pause', left: 1 } }
  }
  const width = MASCOTS[main.mascot].width
  const target = next.heading === 'right' ? next.x - GAP - width : next.x + BUTTERFLY_WIDTH + GAP
  const room = roomFor(main.mascot, canvas)
  const x = main.wanderer.x
  const goal = Math.min(Math.max(target, 0), room)
  const dx = Math.min(Math.max(goal - x, -CHASE_PACE), CHASE_PACE)
  // R3: 進んだコマは歩く脚にし、進んだ向きを向く（進まないコマは蝶々の進む向き）
  const mode = dx === 0 ? ('pause' as const) : ('walk' as const)
  const facing = dx > 0 ? ('right' as const) : dx < 0 ? ('left' as const) : next.heading
  return { ...main, play, wanderer: { ...main.wanderer, x: x + dx, facing, mode, left: 1 } }
}

/**
 * 行列で k 番目の仲間が本体からさかのぼる距離 S(k) の一覧（R4）。
 * 道具は前の 1 体の側に描くので、道具を持つ仲間の前はその張り出しの分も空ける（R4 の P・R11）
 */
function spacing(main: Member, followers: readonly Member[]): number[] {
  let offset = 0
  let ahead = MASCOTS[main.mascot].width
  return followers.map(m => {
    const width = MASCOTS[m.mascot].width
    offset += Math.max(ahead, width) + PARADE_GAP + reach(m.prop)
    ahead = width
    return offset
  })
}

/**
 * 行列していないコマに、本体が歩けて、いる仲間が 1 体以上いて、本体の後ろに列が収まれば、
 * PARADE_CHANCE の確率で行列を始める（R1・R2・R9・S1）。本体は帯の広いほうを向き、
 * 仲間は本体の後ろに近い順（前にいる者はそのあと、歩けない者は最後。parade-rejoin の R6）に並べ替える。
 * 条件を満たさないときは random を呼ばない。`canvas` は帯の幅（ピクセル）。
 */
export function lineUp(crew: Crew, random: () => number, canvas: number, timing: Timing = DEFAULT_TIMING): Crew {
  const [main, ...friends] = crew
  // play の R3: ひとり遊びの間は行列を始めない
  if (main === undefined || main.parade !== null || main.play !== null || !canWalk(main, timing)) return crew
  const x = main.wanderer.x
  const room = roomFor(main.mascot, canvas)
  const heading: Heading = room - x >= x ? 'right' : 'left'
  // R9: 後ろにいる者は本体に近い順、前にいる者はそのあとに近い順。
  // 歩けない者はその全員のあと（parade-rejoin の R6: 後ろの仲間を始めから待たせない）
  const sign = heading === 'right' ? 1 : -1
  const rank = (m: Member) => {
    const behind = (x - m.wanderer.x) * sign
    return behind >= 0 ? behind : canvas - behind
  }
  const ordered = [...friends].sort((a, b) => Number(!canWalk(a, timing)) - Number(!canWalk(b, timing)) || rank(a) - rank(b))
  const line = spacing(main, ordered.filter(m => m.presence.kind === 'here'))
  if (line.length === 0) return crew
  // R1: 本体の後ろに列が収まらなければ始めない（壁ぎわで重ならないように）
  const behindRoom = heading === 'right' ? x : room - x
  if (behindRoom < line[line.length - 1]!) return crew
  if (random() >= PARADE_CHANCE) return crew
  const frames = between(random, PARADE_FRAMES.min, PARADE_FRAMES.max)
  const parade = begin(x, heading, room, frames)
  return [{ ...main, wanderer: { ...main.wanderer, facing: heading }, parade }, ...ordered]
}

/**
 * 待っている仲間 m が、すぐ前の ahead との間に 1 体分の間隔（道具の分を含む。R4）を空けられる位置。
 * 間が足りていれば今の位置のまま（前へは詰めない。parade-rejoin の R5）。`sign` は行列の向き（右なら 1）。
 * 左へ進む行列では ahead の記号が m の側に出るので、その張り出しも空ける（parade-rejoin の R7）
 */
function backOff(ahead: Member, m: Member, sign: number, room: number, timing: Timing): number {
  const emote = sign < 0 ? emoteOf(ahead, timing) : null
  const gap =
    Math.max(MASCOTS[ahead.mascot].width, MASCOTS[m.mascot].width) +
    PARADE_GAP +
    reach(m.prop) +
    (emote === null ? 0 : emoteReach(ahead.mascot, emote))
  const limit = ahead.wanderer.x - sign * gap
  const x = m.wanderer.x
  return (x - limit) * sign > 0 ? Math.min(Math.max(limit, 0), room) : x
}

/**
 * 行列を 1 コマ進める（R3〜R7・R10、.scratch/parade-rejoin/spec.md）。本体を行列の向きへ 1 ピクセル進めて道筋に足し、
 * 歩ける仲間を並び順に、道筋をさかのぼった目標へ寄せる。並び順で前に歩けない仲間がいる仲間は、
 * 前へは進まずに待ち、すぐ前の仲間との間が足りないときだけ下がる。
 * 残りが尽きる・本体が端に着く・本体がいなくなる、のどれかで行列をやめる。
 */
function march(crew: Crew, canvas: number, random: () => number, timing: Timing): Crew {
  const [main, ...friends] = crew as [Member, ...Member[]]
  const parade = main.parade!
  const moves = canWalk(main, timing)
  const next = main.wanderer.x + (parade.heading === 'right' ? 1 : -1)
  const atEdge = moves && (next < 0 || next > roomFor(main.mascot, canvas))
  if (parade.left <= 1 || main.presence.kind !== 'here' || atEdge) {
    // R6・S5・S6: 本体も仲間もその場で少し立ち止まってから、自分で歩き出す
    const pause = (m: Member): Member => ({
      ...m,
      wanderer: { ...m.wanderer, mode: 'pause', left: between(random, PARADE_PAUSE.min, PARADE_PAUSE.max) },
    })
    return [{ ...pause(main), parade: null }, ...friends.map(pause)]
  }
  // R3: 本体は引き返さず、立ち止まらずに 1 ピクセルずつ進む（驚き・居眠りの間は止まる）
  const wanderer = moves ? { ...main.wanderer, x: next, facing: parade.heading, mode: 'walk' as const, left: 1 } : main.wanderer
  const trail = record(parade, wanderer.x)
  const walkers = friends.filter(m => canWalk(m, timing))
  const offsets = spacing(main, walkers)
  // R10: k 番目が道具のぶん下がる距離（自分と前の仲間の張り出しの合計）
  let reaches = 0
  const shifts = walkers.map(m => (reaches += reach(m.prop)))
  const sign = parade.heading === 'right' ? 1 : -1
  // 並び順に 1 体ずつ動かし、すぐ前の仲間はこのコマで動いたあとの位置を見る
  const followers: Member[] = []
  for (const [i, m] of friends.entries()) {
    const k = walkers.indexOf(m)
    if (k < 0) {
      followers.push(m) // R7: 歩けない間は進まない
      continue
    }
    const room = roomFor(m.mascot, canvas)
    const target = Math.min(Math.max(slot(trail, offsets[k]!), 0), room)
    // parade-rejoin の R1: 並び順で前に歩けない仲間がいる間は、追い越さないよう前へは進まない。
    // R5: ただし、すぐ前の仲間との間が道具の分を含めて足りなければ、その分だけ下がる
    const waiting = friends.slice(0, i).some(f => !canWalk(f, timing))
    const ahead = followers[i - 1]
    const goal = waiting ? backOff(ahead!, m, sign, room, timing) : target
    const dx = Math.min(Math.max(goal - m.wanderer.x, -FOLLOW_PACE), FOLLOW_PACE)
    // R10: 行列の向きと逆へ、道具のぶん下がるだけのときは、向きを変えずに後ずさりする。
    // parade-rejoin の R5: 待っている間は、すぐ前の仲間より後ろにいれば後ずさり、前にいれば（回り込みの途中）進む向きを向く
    const backward = dx * sign < 0
    const behind = waiting && (ahead!.wanderer.x - m.wanderer.x) * sign > 0
    const backstep = backward && (waiting ? behind : Math.abs(target - m.wanderer.x) <= shifts[k]!)
    // parade-rejoin の R1: 待って立つ間は、行列の向きを向く
    const standing = waiting ? parade.heading : m.wanderer.facing
    const facing = dx === 0 ? standing : backstep ? m.wanderer.facing : dx > 0 ? ('right' as const) : ('left' as const)
    // 進んだコマは歩く脚、進まないコマは直立（R5）
    const mode = dx === 0 ? ('pause' as const) : ('walk' as const)
    followers.push({ ...m, wanderer: { ...m.wanderer, x: m.wanderer.x + dx, facing, mode, left: 1 } })
  }
  return [{ ...main, wanderer, parade: { ...trail, left: parade.left - 1 } }, ...followers]
}

/** 描く Actor の一覧。現れかけ・消えかけの者は正面を向いて立ち、濃さと浮きが付く */
export function actors(crew: Crew, timing: Timing = DEFAULT_TIMING): Actor[] {
  return crew
    .filter(m => m.presence.kind !== 'gone')
    .map(m => {
      const actor = actorOf(m, timing)
      // cheer の R2・R4・R5: 紙吹雪は、出入りの途中でなければ、ほかの見え方に重ねて描く
      return m.cheer > 0 && look(m.presence) === null ? { ...actor, confetti: { left: m.cheer } } : actor
    })
}

/** 1 体の見え方（紙吹雪を除く） */
function actorOf(m: Member, timing: Timing): Actor {
  const base = { mascot: m.mascot, x: m.wanderer.x, color: m.color }
  const fading = look(m.presence)
  if (fading === null && m.squash?.kind === 'pressed') {
    // squash の R2: つぶれた絵（幅 + 2）を 1 ピクセル左から描く。道具・記号は描かない
    return { ...base, x: base.x - 1, facing: 'front' as const, pose: 'stand' as const, squashed: true as const }
  }
  if (fading === null && m.startle > 0) {
    // T2: 「!」を出す。最初の SHAKE_FRAMES コマは 1 コマごとに左右へ 1 ピクセル震える
    const shaking = m.startle > STARTLE_FRAMES - SHAKE_FRAMES
    const shake = !shaking ? 0 : m.startle % 2 === 0 ? 1 : -1
    return { ...base, x: base.x + shake, facing: 'front' as const, pose: 'stand' as const, emote: { kind: 'startle' as const } }
  }
  if (fading === null && m.idle >= timing.dozeFrames) {
    // T3: 目を閉じて正面を向き、「z」を上下させる
    const high = Math.floor(m.idle / Z_EVERY) % 2 === 0
    return { ...base, facing: 'front' as const, pose: 'sleep' as const, emote: { kind: 'doze' as const, high } }
  }
  if (fading === null && m.play !== null) {
    // ひとり遊びの間は道具を描かない（surf の R8・butterfly の R7）
    switch (m.play.kind) {
      case 'surf':
        // surf の R9: 板に乗って向かう側を向く
        return { ...base, facing: m.play.heading, pose: 'stand' as const, surf: { heading: m.play.heading, fade: fadeOf(m.play) } }
      case 'butterfly':
        // butterfly の R3・R8: 追いかけて歩き（見送る間は正面で直立）、蝶々を描く
        return { ...base, facing: m.wanderer.facing, pose: poseOf(m.wanderer), butterfly: m.play }
    }
  }
  if (fading === null) {
    const pose = poseOf(m.wanderer)
    const facing = m.wanderer.facing
    // squash の R3: 戻っている間は浮きを 1・1・0・1・0 にする（ぽよん）
    const lift = liftOf(m.squash)
    const spring = lift > 0 ? { lift } : {}
    if (m.prop === null) return { ...base, facing, pose, ...spring }
    // props の T4: 向いている側に道具を持つ。ハンマーは脚のコマに合わせて上下する（R5・R6）
    const side = facing === 'left' ? ('left' as const) : ('right' as const)
    const raised = m.prop.kind === 'hammer' && pose === 'stepB'
    return { ...base, facing, pose, ...spring, prop: { kind: m.prop.kind, side, raised } }
  }
  return { ...base, facing: 'front' as const, pose: 'stand' as const, ...fading }
}

/** id の 1 体のテストが通った（cheer の R1）。紙吹雪を CHEER_FRAMES 降らせる。いない id・消えきっている 1 体では何もしない */
export const celebrate = (crew: Crew, id: string): Crew =>
  crew.map(m => (m.id !== id || m.presence.kind === 'gone' ? m : { ...m, cheer: CHEER_FRAMES }))

/**
 * id の 1 体のループで会話の圧縮が始まった（squash の R1・S1・S5・S9）。押しつぶす。
 * まだ現れていない本体も押しつぶす（`/compact` は本体が現れるのと同時に始まるため）。いない id では何もしない
 */
export const squeeze = (crew: Crew, id: string): Crew => crew.map(m => (m.id !== id ? m : { ...m, squash: PRESSED }))

/**
 * id の 1 体のループで会話の圧縮が終わった（squash の R3・S6）。押しつぶされていれば戻り始め、途切れを 0 に戻す。
 * 押しつぶされていなければ何もしない（R6・S2・S10）
 */
export const unsqueeze = (crew: Crew, id: string): Crew =>
  crew.map(m => (m.id !== id || m.squash?.kind !== 'pressed' ? m : { ...m, squash: unpress(m.squash), idle: 0 }))

/**
 * id の 1 体のツールの呼び出しが始まった。動いている呼び出しの数を 1 増やす（emotes の R12）。
 * いない id・消えきっている 1 体では何もしない
 */
export const engage = (crew: Crew, id: string): Crew =>
  crew.map(m => (m.id !== id || m.presence.kind === 'gone' ? m : { ...m, busy: m.busy + 1 }))

/**
 * id の 1 体のツールの呼び出しが終わった。動いている呼び出しの数を 1 減らす（0 より下げない。emotes の R12）。
 * いない id では何もしない
 */
export const disengage = (crew: Crew, id: string): Crew =>
  crew.map(m => (m.id !== id ? m : { ...m, busy: Math.max(0, m.busy - 1) }))

/**
 * id の 1 体に活動があった（ツールの呼び出しが始まった・終わった）。途切れを 0 に戻し、
 * 失敗していればいる 1 体を驚かせる。id がいなければ何もしない（R10）。
 */
export function poke(crew: Crew, id: string, failed: boolean): Crew {
  return crew.map(m =>
    m.id !== id
      ? m
      : { ...m, idle: 0, startle: failed && m.presence.kind === 'here' ? STARTLE_FRAMES : m.startle },
  )
}

/**
 * id の 1 体のツール `tool` の呼び出しが始まった。対応する道具を求め（持ち替えてから 1.5 秒は今の道具のまま。R23）、
 * 使っている数を 1 増やす（R1・R2・R17〜R20）。`command` は Bash のコマンド（テストを走らせるならフラスコ）。
 * 使い終えてからの残りは `timing.propFrames` にする。
 * 対応しないツール・いない id・消えきっている 1 体では何もしない（R3・R10・R15）。
 */
export function wield(crew: Crew, id: string, tool: string, command?: unknown, timing: Timing = DEFAULT_TIMING): Crew {
  return regrip(crew, id, propFor(tool, command), (grip, kind) => grab(grip, kind, timing.propFrames))
}

/**
 * id の 1 体のツール `tool` の呼び出しが終わった。対応する道具を求め（R23）、使っている数を 1 減らして、
 * 使い終えてからの残りを `timing.propFrames` に数え直す（R11・R13）。何もしない場合は wield と同じ。
 */
export function release(crew: Crew, id: string, tool: string, command?: unknown, timing: Timing = DEFAULT_TIMING): Crew {
  return regrip(crew, id, propFor(tool, command), (grip, kind) => relax(grip, kind, timing.propFrames))
}

/** id の 1 体の道具を、道具 `kind` で持ち直す。道具を持つのは活動なので、途切れも 0 に戻す。kind が null なら何もしない */
function regrip(crew: Crew, id: string, kind: PropId | null, change: (grip: Grip | null, kind: PropId) => Grip): Crew {
  if (kind === null) return crew
  return crew.map(m => (m.id !== id || m.presence.kind === 'gone' ? m : { ...m, idle: 0, prop: change(m.prop, kind) }))
}
