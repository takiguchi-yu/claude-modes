// 帯を歩く顔ぶれ。本体の Clawd 1 体と、動いているサブエージェント 1 体ごとの仲間。
//
// エージェントの一覧に合わせて増減させ、絵と色を割り当て、全員を 1 コマずつ進める。
// 新しく来た仲間は、まだいない種類の絵でランダムな位置に現れる。
// 現れるときは上から降りながら、いなくなるときは浮き上がりながら、その場でふわっと出入りする
// （出入りの状態遷移は presence.ts）。現れかけ・消えかけの間は歩かない。
// ツールの呼び出し（poke）が途切れると居眠りし、失敗すると驚く（.scratch/emotes/spec.md）。
// 先頭は常に本体（MAIN）。本体は消えても顔ぶれに残り、次に作業が始まると同じ場所に戻る。
// Claude Code の API は知らない。

import { FRIENDS, type MascotId, MASCOTS } from './mascots'
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
}

/** 活動がこのコマ数途切れたら居眠りする（20 秒） */
export const DOZE_FRAMES = 200
/** 驚いているコマ数（2 秒）。最初の SHAKE_FRAMES コマだけ震える */
export const STARTLE_FRAMES = 20
const SHAKE_FRAMES = 8
/** 居眠りの z を何コマごとに上下させるか */
const Z_EVERY = 5

export type Crew = readonly Member[]

export const assemble = (): Crew => [
  { id: MAIN, mascot: 'clawd', color: ORANGE, wanderer: start(), presence: GONE, idle: 0, startle: 0, prop: null },
]

/** 消えかけも含めて、いまいるサブエージェントの数 */
export const agentCount = (crew: Crew): number => crew.length - 1

/** 帯に描くものが 1 体でも残っているか（現れかけ・消えかけを含む） */
export const isVisible = (crew: Crew): boolean => crew.some(m => m.presence.kind !== 'gone')

const shown = (m: Member): Member => ({ ...m, presence: appear(m.presence) })
const hidden = (m: Member): Member => ({ ...m, presence: retreat(m.presence) })

/** 置ける x の最大（ピクセル）。帯の幅 `canvas` から絵の幅を引いたもの */
const roomFor = (mascot: MascotId, canvas: number) => Math.max(0, canvas - MASCOTS[mascot].width)

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
    added.push(shown({ id, mascot, color, wanderer: { ...start(), x }, presence: GONE, idle: 0, startle: 0, prop: null }))
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
  const next = crew.map(m => {
    const isHere = m.presence.kind === 'here'
    // デシジョンテーブル T2〜T4: 驚いている・居眠りしている間は歩かない
    const walks = isHere && m.startle === 0 && m.idle < DOZE_FRAMES
    return {
      ...m,
      wanderer: walks ? step(m.wanderer, roomFor(m.mascot, canvas), random) : m.wanderer,
      presence: elapse(m.presence),
      idle: isHere ? m.idle + 1 : 0,
      startle: Math.max(0, m.startle - 1),
      prop: m.prop !== null && m.prop.left > 1 ? { ...m.prop, left: m.prop.left - 1 } : null,
    }
  })
  return next.filter(m => m.id === MAIN || m.presence.kind !== 'gone')
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
