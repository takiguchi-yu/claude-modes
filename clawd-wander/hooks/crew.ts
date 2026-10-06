// 帯を歩く顔ぶれ。本体の Clawd 1 体と、動いているサブエージェント 1 体ごとの仲間。
//
// エージェントの一覧に合わせて増減させ、絵と色を割り当て、全員を 1 コマずつ進める。
// 新しく来た仲間は、まだいない種類の絵でランダムな位置に現れる。
// 現れるときは上から降りながら、いなくなるときは浮き上がりながら、その場でふわっと出入りする
// （出入りの状態遷移は presence.ts）。現れかけ・消えかけの間は歩かない。
// ツールの呼び出し（poke）が途切れると居眠りし、失敗すると驚く（.scratch/emotes/spec.md）。
// ときどき仲間が本体のあとを一列についていく（lineUp。.scratch/parade/spec.md）。
// 先頭は常に本体（MAIN）。本体は消えても顔ぶれに残り、次に作業が始まると同じ場所に戻る。
// Claude Code の API は知らない。

import { FRIENDS, type MascotId, MASCOTS } from './mascots'
import { begin, type Heading, type Parade, record, slot } from './parade'
import { appear, elapse, GONE, look, type Presence, retreat } from './presence'
import { PROP_FRAMES, propFor, type PropId } from './props'
import { type Actor, ORANGE } from './sprite'
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
  /** 最後の活動（ツールの呼び出し）からのコマ数。いる間だけ数える */
  readonly idle: number
  /** 驚きの残りコマ数。0 なら驚いていない */
  readonly startle: number
  /** 手に持っている道具と残りコマ数。持っていなければ null（.scratch/props/spec.md） */
  readonly prop: { readonly kind: PropId; readonly left: number } | null
  /** 率いている行列。本体だけが持ち、仲間は常に null（.scratch/parade/spec.md） */
  readonly parade: Parade | null
}

/** 活動がこのコマ数途切れたら居眠りする（60 秒） */
export const DOZE_FRAMES = 600
/** 驚いているコマ数（2 秒）。最初の SHAKE_FRAMES コマだけ震える */
export const STARTLE_FRAMES = 20
const SHAKE_FRAMES = 8
/** 居眠りの z を何コマごとに上下させるか */
const Z_EVERY = 5
/** 行列を始める確率（1 コマあたり）と、続けるコマ数の範囲 */
export const PARADE_CHANCE = 1 / 150
const PARADE_FRAMES = { min: 80, max: 150 }
/** 行列で前の 1 体との間に空けるピクセル数と、仲間が 1 コマに進めるピクセル数（本体は 1 ピクセル） */
const PARADE_GAP = 2
const FOLLOW_PACE = 4
/** 行列が終わったあと、仲間が立ち止まるコマ数の範囲 */
const PARADE_PAUSE = { min: 5, max: 15 }

export type Crew = readonly Member[]

export const assemble = (): Crew => [
  { id: MAIN, mascot: 'clawd', color: ORANGE, wanderer: start(), presence: GONE, idle: 0, startle: 0, prop: null, parade: null },
]

/** 消えかけも含めて、いまいるサブエージェントの数 */
export const agentCount = (crew: Crew): number => crew.length - 1

/** 帯に描くものが 1 体でも残っているか（現れかけ・消えかけを含む） */
export const isVisible = (crew: Crew): boolean => crew.some(m => m.presence.kind !== 'gone')

const shown = (m: Member): Member => ({ ...m, presence: appear(m.presence) })
const hidden = (m: Member): Member => ({ ...m, presence: retreat(m.presence) })

/** 置ける x の最大（ピクセル）。帯の幅 `canvas` から絵の幅を引いたもの */
const roomFor = (mascot: MascotId, canvas: number) => Math.max(0, canvas - MASCOTS[mascot].width)

/** min 以上 max 以下の整数を乱数で選ぶ */
const between = (random: () => number, min: number, max: number) => min + Math.floor(random() * (max - min + 1))

/** 歩けるか: いる・驚いていない・居眠りしていない（デシジョンテーブル T4） */
const canWalk = (m: Member) => m.presence.kind === 'here' && m.startle === 0 && m.idle < DOZE_FRAMES

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
export function sync(crew: Crew, agentIds: readonly string[], random: () => number, canvas: number): Crew {
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
    added.push(shown({ id, mascot, color, wanderer: { ...start(), x }, presence: GONE, idle: 0, startle: 0, prop: null, parade: null }))
  }
  return [main, ...kept, ...added]
}

/**
 * サブエージェントが 1 体起動した。ほかの顔ぶれはそのまま。
 * sync は一覧に無い者を外さず消し始めるだけなので、消えかけの者は消えかけのまま残る。
 */
export function join(crew: Crew, id: string, random: () => number, canvas: number): Crew {
  const present = crew
    .slice(1)
    .filter(m => m.presence.kind === 'arriving' || m.presence.kind === 'here')
    .map(m => m.id)
  return sync(crew, [...present, id], random, canvas)
}

/**
 * 全員を 1 コマ進める。`canvas` は帯の幅（ピクセル）。
 * いる者だけが歩き、現れかけ・消えかけの者はその場で止まって残りコマを減らす。
 * 消えきった仲間は外す。本体は外さない。
 */
export function advance(crew: Crew, canvas: number, random: () => number): Crew {
  const marching = crew[0]?.parade != null
  const next = crew.map(m => {
    const isHere = m.presence.kind === 'here'
    // デシジョンテーブル T2〜T4: 驚いている・居眠りしている間は歩かない。
    // 行列の間は本体も仲間も自分では歩かず、march で進む
    const walks = canWalk(m) && !marching
    return {
      ...m,
      wanderer: walks ? step(m.wanderer, roomFor(m.mascot, canvas), random) : m.wanderer,
      presence: elapse(m.presence),
      idle: isHere ? m.idle + 1 : 0,
      startle: Math.max(0, m.startle - 1),
      prop: m.prop !== null && m.prop.left > 1 ? { ...m.prop, left: m.prop.left - 1 } : null,
    }
  })
  const kept = next.filter(m => m.id === MAIN || m.presence.kind !== 'gone')
  return marching ? march(kept, canvas, random) : kept
}

/** 行列で k 番目の仲間が本体からさかのぼる距離 S(k) の一覧（R4） */
function spacing(main: Member, followers: readonly Member[]): number[] {
  let offset = 0
  let ahead = MASCOTS[main.mascot].width
  return followers.map(m => {
    const width = MASCOTS[m.mascot].width
    offset += Math.max(ahead, width) + PARADE_GAP
    ahead = width
    return offset
  })
}

/**
 * 行列していないコマに、本体が歩けて、いる仲間が 1 体以上いて、本体の後ろに列が収まれば、
 * PARADE_CHANCE の確率で行列を始める（R1・R2・R9・S1）。本体は帯の広いほうを向き、
 * 仲間は本体の後ろに近い順（前にいる者はそのあと）に並べ替える。
 * 条件を満たさないときは random を呼ばない。`canvas` は帯の幅（ピクセル）。
 */
export function lineUp(crew: Crew, random: () => number, canvas: number): Crew {
  const [main, ...friends] = crew
  if (main === undefined || main.parade !== null || !canWalk(main)) return crew
  const x = main.wanderer.x
  const room = roomFor(main.mascot, canvas)
  const heading: Heading = room - x >= x ? 'right' : 'left'
  // R9: 後ろにいる者は本体に近い順、前にいる者はそのあとに近い順
  const sign = heading === 'right' ? 1 : -1
  const rank = (m: Member) => {
    const behind = (x - m.wanderer.x) * sign
    return behind >= 0 ? behind : canvas - behind
  }
  const ordered = [...friends].sort((a, b) => rank(a) - rank(b))
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
 * 行列を 1 コマ進める（R3〜R7）。本体を行列の向きへ 1 ピクセル進めて道筋に足し、
 * 歩ける仲間を並び順に、道筋をさかのぼった目標へ寄せる。
 * 残りが尽きる・本体が端に着く・本体がいなくなる、のどれかで行列をやめる。
 */
function march(crew: Crew, canvas: number, random: () => number): Crew {
  const [main, ...friends] = crew as [Member, ...Member[]]
  const parade = main.parade!
  const moves = canWalk(main)
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
  const walkers = friends.filter(canWalk)
  const offsets = spacing(main, walkers)
  const followers = friends.map(m => {
    const k = walkers.indexOf(m)
    if (k < 0) return m // R7: 歩けない間は進まない
    const offset = offsets[k]!
    const target = Math.min(Math.max(slot(trail, offset), 0), roomFor(m.mascot, canvas))
    const dx = Math.min(Math.max(target - m.wanderer.x, -FOLLOW_PACE), FOLLOW_PACE)
    const facing = dx > 0 ? ('right' as const) : dx < 0 ? ('left' as const) : m.wanderer.facing
    // 進んだコマは歩く脚、進まないコマは直立（R5）
    const mode = dx === 0 ? ('pause' as const) : ('walk' as const)
    return { ...m, wanderer: { ...m.wanderer, x: m.wanderer.x + dx, facing, mode, left: 1 } }
  })
  return [{ ...main, wanderer, parade: { ...trail, left: parade.left - 1 } }, ...followers]
}

/** 描く Actor の一覧。現れかけ・消えかけの者は正面を向いて立ち、濃さと浮きが付く */
export function actors(crew: Crew): Actor[] {
  return crew
    .filter(m => m.presence.kind !== 'gone')
    .map(m => {
      const base = { mascot: m.mascot, x: m.wanderer.x, color: m.color }
      const fading = look(m.presence)
      if (fading === null && m.startle > 0) {
        // T2: 「!」を出す。最初の SHAKE_FRAMES コマは 1 コマごとに左右へ 1 ピクセル震える
        const shaking = m.startle > STARTLE_FRAMES - SHAKE_FRAMES
        const shake = !shaking ? 0 : m.startle % 2 === 0 ? 1 : -1
        return { ...base, x: base.x + shake, facing: 'front' as const, pose: 'stand' as const, emote: { kind: 'startle' as const } }
      }
      if (fading === null && m.idle >= DOZE_FRAMES) {
        // T3: 目を閉じて正面を向き、「z」を上下させる
        const high = Math.floor(m.idle / Z_EVERY) % 2 === 0
        return { ...base, facing: 'front' as const, pose: 'sleep' as const, emote: { kind: 'doze' as const, high } }
      }
      if (fading === null) {
        const pose = poseOf(m.wanderer)
        const facing = m.wanderer.facing
        if (m.prop === null) return { ...base, facing, pose }
        // T4: 向いている側に道具を持つ。ハンマーは脚のコマに合わせて上下する（R5・R6）
        const side = facing === 'left' ? ('left' as const) : ('right' as const)
        const raised = m.prop.kind === 'hammer' && pose === 'stepB'
        return { ...base, facing, pose, prop: { kind: m.prop.kind, side, raised } }
      }
      return { ...base, facing: 'front' as const, pose: 'stand' as const, ...fading }
    })
}

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
 * id の 1 体に、ツール `tool` に対応する道具を持たせ、残りを PROP_FRAMES にする。
 * 道具を持つのは活動なので、途切れも 0 に戻す。対応しないツール、いない id では何もしない。
 */
export function wield(crew: Crew, id: string, tool: string): Crew {
  const kind = propFor(tool)
  if (kind === null) return crew
  return crew.map(m => (m.id !== id ? m : { ...m, idle: 0, prop: { kind, left: PROP_FRAMES } }))
}
