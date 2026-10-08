import type { AgentInfo, AgentStatus, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import {
  actors,
  advance,
  agentCount,
  assemble,
  beginPlay,
  celebrate,
  type Crew,
  DEFAULT_TIMING,
  disengage,
  DOZE_FRAMES,
  engage,
  isVisible,
  join,
  lineUp,
  MAIN,
  MAX_AGENTS,
  type Member,
  PARADE_CHANCE,
  poke,
  release,
  setMain,
  STARTLE_FRAMES,
  squeeze,
  startPlay,
  sync,
  timingOf,
  unsqueeze,
  wantsMain,
  wield,
} from '../hooks/crew'
import { begin, record, slot, TRAIL } from '../hooks/parade'
import { decay, grab, PROP_FRAMES, PROP_GAP, propBitmap, propFor, propPixels, reach, relax, runsTests, SWAP_FRAMES } from '../hooks/props'
import { FRIENDS, MASCOT_HEIGHT, type MascotId, MASCOTS } from '../hooks/mascots'
import { appear, elapse, FADE_FRAMES, GONE, HERE, LEAP_FRAMES, retreat } from '../hooks/presence'
import { type Actor, BANG_COLOR, ORANGE, paint, SPRITE_ROWS } from '../hooks/sprite'
import { poseOf, setOff, start, step, type Wanderer } from '../hooks/wander'
import { EBB_FRAMES, MIN_RIDE, SURF_PACE, surfPixels } from '../hooks/surf'
import { PLAY_CHANCE, playable } from '../hooks/play'
import { DANCE_FRAMES, dancePose } from '../hooks/dance'
import { butterflyPixels, CHASE_FRAMES, GAP, launch, MIN_CHASE, WATCH_FRAMES } from '../hooks/butterfly'
import { CHEER_FRAMES, confettiPixels } from '../hooks/cheer'
import { flatten, SPRING_FRAMES } from '../hooks/squash'

const PLUGIN = 'clawd-wander'
const BLUE = 0x6a9bcc

const bandProps = (isWorking: boolean, bodyColumns = 40) => ({
  hasSurvey: false,
  isWorking,
  maxRows: 10,
  bodyColumns,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
})

/**
 * 実際の帯を使うテストの設定。ひとり遊びは乱数で始まり、テストから乱数は決められないので止める
 * （偶然の遊びで道具が隠れないように。.scratch/play/spec.md の R5）
 */
const NO_PLAY = { options: { play: false } }

const band = (isWorking: boolean, bodyColumns = 40) => ({
  plugin: PLUGIN,
  component: 'AbovePrompt' as const,
  props: bandProps(isWorking, bodyColumns),
})

const clawd = (x: number, overrides: Partial<Actor> = {}): Actor => ({
  mascot: 'clawd',
  x,
  facing: 'front',
  pose: 'stand',
  color: ORANGE,
  ...overrides,
})

const agent = (id: string, status: AgentStatus): AgentInfo => ({ id, description: id, type: 'Explore', status })

/** 決まった順に値を返す乱数の代わり。尽きたら 0 */
const seq = (...values: number[]) => () => values.shift() ?? 0

/** n コマ進める（乱数は固定） */
const advanceBy = (crew: Crew, frames: number, canvas = 100): Crew => {
  let next = crew
  for (let i = 0; i < frames; i += 1) next = advance(next, canvas, () => 0.5)
  return next
}

/** 帯の下（エンジンとほかの mod）の代わりに、目印の Box を描く */
function beneath(on: On) {
  on('ui.render', async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return Box({ key: 'beneath', children: [Text({ children: ['beneath'] })] })
  })
}

/** Raster の cells を、行ごとの文字列と色ごとのセル数に戻す */
function decode(cells: string, columns: number) {
  const binary = atob(cells)
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
  const words = new Uint32Array(bytes.buffer)
  const lines: string[] = []
  const colors = new Map<number, number>()
  for (let row = 0; row < words.length / 3 / columns; row += 1) {
    let line = ''
    for (let col = 0; col < columns; col += 1) {
      const at = (row * columns + col) * 3
      line += String.fromCodePoint(words[at]!)
      if (words[at] !== 0x20) colors.set(words[at + 1]!, (colors.get(words[at + 1]!) ?? 0) + 1)
    }
    lines.push(line)
  }
  return { lines, colors }
}

/** cells に使われている色（文字の色と背景の色。端末の既定の色を除く） */
function cellColors(cells: string): Set<number> {
  const words = new Uint32Array(Uint8Array.from(atob(cells), c => c.charCodeAt(0)).buffer)
  const used = new Set<number>()
  for (let at = 0; at < words.length; at += 3) {
    if (words[at] === 0x20) continue
    for (const color of [words[at + 1]!, words[at + 2]!]) if (color !== 0x01000000) used.add(color)
  }
  return used
}

/** 象限ブロック文字の行を、ピクセルの行（1 文字 = 横 2 × 縦 2）に戻す */
function pixels(lines: string[]): boolean[][] {
  const QUADRANTS = ' ▗▖▄▝▐▞▟▘▚▌▙▀▜▛█'
  return lines.flatMap(line => {
    const top: boolean[] = []
    const bottom: boolean[] = []
    for (const ch of line) {
      const bits = QUADRANTS.indexOf(ch)
      top.push((bits & 8) !== 0, (bits & 4) !== 0)
      bottom.push((bits & 2) !== 0, (bits & 1) !== 0)
    }
    return [top, bottom]
  })
}

// ---- 絵 ---------------------------------------------------------------------

test('正面・直立の Clawd は起動画面のロゴと同じ形で、1 ピクセル下げて描く', () => {
  const logo = pixels([' ▐▛███▜▌ ', '▝▜█████▛▘', '  ▘▘ ▝▝  '])
  const drawn = pixels(decode(paint([clawd(0)], 9), 9).lines)
  expect(drawn[0]!.some(Boolean)).toBe(false)
  expect(drawn.slice(1)).toEqual(logo.slice(0, 5))
})

test('足は帯の最下行の下半分（入力欄の側）に着く', () => {
  for (const pose of ['stand', 'stepA', 'stepB'] as const) {
    const drawn = pixels(decode(paint([clawd(0, { facing: 'right', pose })], 9), 9).lines)
    expect(drawn[drawn.length - 1]!.some(Boolean)).toBe(true)
  }
})

test('奇数ピクセルずらしても形が崩れず、帯の外ははみ出さない', () => {
  const columns = 12
  const right = decode(paint([clawd(2 * columns - MASCOTS.clawd.width, { facing: 'right', pose: 'stepB' })], columns), columns)
  expect(right.lines).toHaveLength(SPRITE_ROWS)
  expect(right.colors.get(ORANGE)).toBeGreaterThan(10)
  const clipped = decode(paint([clawd(2 * columns - 4, { facing: 'left', pose: 'stepA' })], columns), columns)
  expect(clipped.lines.every(line => [...line].length === columns)).toBe(true)
})

test('何体でも 1 枚に描き、それぞれの色で塗る', () => {
  const { colors } = decode(paint([clawd(0), clawd(20, { color: BLUE })], 20), 20)
  expect(colors.get(ORANGE)).toBeGreaterThan(10)
  expect(colors.get(BLUE)).toBeGreaterThan(10)
})

test('薄くするとピクセルが間引かれ、0 で消える', () => {
  const full = decode(paint([clawd(0)], 9), 9).colors.get(ORANGE) ?? 0
  const half = decode(paint([clawd(0, { opacity: 0.5 })], 9), 9).colors.get(ORANGE) ?? 0
  const none = decode(paint([clawd(0, { opacity: 0 })], 9), 9).colors.get(ORANGE) ?? 0
  expect(half).toBeGreaterThan(0)
  expect(half).toBeLessThanOrEqual(full)
  expect(none).toBe(0)
  const fullPx = pixels(decode(paint([clawd(0)], 9), 9).lines).flat().filter(Boolean).length
  const halfPx = pixels(decode(paint([clawd(0, { opacity: 0.5 })], 9), 9).lines).flat().filter(Boolean).length
  expect(halfPx).toBeLessThan(fullPx * 0.7)
  expect(halfPx).toBeGreaterThan(fullPx * 0.3)
})

test('浮かせると足が帯の下端から離れ、上端からはみ出す分は切る', () => {
  const lifted = pixels(decode(paint([clawd(0, { lift: 1 })], 9), 9).lines)
  expect(lifted[lifted.length - 1]!.some(Boolean)).toBe(false)
  const flown = pixels(decode(paint([clawd(0, { lift: 4 })], 9), 9).lines)
  expect(flown.flat().some(Boolean)).toBe(true)
  expect(flown.slice(2).flat().some(Boolean)).toBe(false)
})

test('どのマスコットも高さ 6・幅そろい・足が最下行にあり、歩くと絵が変わる', () => {
  for (const [id, mascot] of Object.entries(MASCOTS)) {
    for (const facing of ['left', 'front', 'right'] as const) {
      for (const pose of ['stand', 'stepA', 'stepB', 'sleep'] as const) {
        const bitmap = mascot.draw(facing, pose)
        expect({ id, rows: bitmap.length }).toEqual({ id, rows: MASCOT_HEIGHT })
        expect({ id, widths: [...new Set(bitmap.map(row => row.length))] }).toEqual({ id, widths: [mascot.width] })
        expect({ id, feet: bitmap[MASCOT_HEIGHT - 1]!.some(Boolean) }).toEqual({ id, feet: true })
      }
    }
    expect({ id, moves: JSON.stringify(mascot.draw('right', 'stepA')) !== JSON.stringify(mascot.draw('right', 'stepB')) })
      .toEqual({ id, moves: true })
  }
})

test('左右で形が違う絵は、左を向くと反転する', () => {
  for (const id of ['dino', 'cat'] as const) {
    const right = MASCOTS[id].draw('right', 'stepA')
    const left = MASCOTS[id].draw('left', 'stepA')
    expect(left).toEqual(right.map(row => [...row].reverse()))
  }
})

test('どのマスコットも 1 枚の帯に描ける', () => {
  const all = (Object.keys(MASCOTS) as MascotId[]).map((mascot, i) => clawd(i * 20, { mascot, color: 0x100000 * (i + 1) }))
  const { colors } = decode(paint(all, 80), 80)
  expect(colors.size).toBe(all.length)
})

// ---- 動き（.scratch/wander/spec.md） -------------------------------------------

/** 再現できる乱数（線形合同法） */
const lcg = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)

const walker = (overrides: Partial<Wanderer> = {}): Wanderer => ({
  x: 50,
  facing: 'right',
  mode: 'walk',
  left: 10,
  gait: 'walk',
  frame: 0,
  ...overrides,
})

/** n コマ歩かせた記録 */
function wanderFor(frames: number, maxX: number, seed = 7): Wanderer[] {
  const random = lcg(seed)
  const trail: Wanderer[] = []
  let w = start()
  for (let i = 0; i < frames; i += 1) {
    w = step(w, maxX, random)
    trail.push(w)
  }
  return trail
}

test('R10・S1・契約 step: 帯の中に収まり、1 コマの移動は 3 ピクセル以内で、左右どちらにも動く', () => {
  const maxX = 60
  const trail = wanderFor(20000, maxX)
  let previous = start()
  for (const w of trail) {
    expect(w.x).toBeGreaterThanOrEqual(0)
    expect(w.x).toBeLessThanOrEqual(maxX)
    expect(Math.abs(w.x - previous.x)).toBeLessThanOrEqual(3)
    expect(['walk', 'pause', 'rest']).toContain(w.mode)
    expect(w.left).toBeGreaterThanOrEqual(1)
    previous = w
  }
  const seen = new Set(trail.map(w => w.x))
  expect(seen.has(0)).toBe(true)
  expect(seen.has(maxX)).toBe(true)
})

test('R10: 帯が縮んだら、まず位置をその中に収める', () => {
  const w = step(walker({ x: 100 }), 20, () => 0.5)
  expect(w.x).toBeLessThanOrEqual(20)
})

test('R11: maxX が負なら 0 とみなす', () => {
  expect(step(walker({ x: 5 }), -10, () => 0.5).x).toBe(0)
})

test('S1: 速さどおりに進む（1 コマで、ゆっくりは 1、ふつうは 2、小走りは 3 ピクセル）', () => {
  const moved = (gait: Wanderer['gait']) => {
    let w = walker({ gait, left: 40 })
    for (let i = 0; i < 10; i += 1) w = step(w, 200, () => 0.5)
    return w.x - 50
  }
  expect(moved('stroll')).toBe(10)
  expect(moved('walk')).toBe(20)
  expect(moved('dash')).toBe(30)
})

test('R1・R2: 歩き始めの距離と速さ', () => {
  // 乱数は「遠くまで行くか」「距離」「速さ」の順に使う
  expect(setOff(0, 'right', seq(0, 0, 0), 0)).toMatchObject({ mode: 'walk', left: 8, gait: 'stroll' })
  expect(setOff(0, 'right', seq(0.49, 0.999, 0.74), 0)).toMatchObject({ left: 24, gait: 'walk' })
  expect(setOff(0, 'right', seq(0.5, 0, 0.75), 0)).toMatchObject({ left: 40, gait: 'dash' })
  expect(setOff(0, 'right', seq(0.99, 0.999, 0.99), 0)).toMatchObject({ left: 160, gait: 'dash' })
  // 長い試行で比率を確かめる（遠くまで 50%・小走り 25%・ゆっくり 15%）
  const random = lcg(11)
  const starts = Array.from({ length: 4000 }, () => setOff(0, 'right', random, 0))
  const far = starts.filter(w => w.left >= 40).length / starts.length
  const dash = starts.filter(w => w.gait === 'dash').length / starts.length
  const stroll = starts.filter(w => w.gait === 'stroll').length / starts.length
  expect(Math.abs(far - 0.5)).toBeLessThan(0.03)
  expect(Math.abs(dash - 0.25)).toBeLessThan(0.03)
  expect(Math.abs(stroll - 0.15)).toBeLessThan(0.03)
})

test('R3・S2: 歩き終えたら、振り返ってすぐ歩く・立ち止まる・休むのどれか', () => {
  const finish = (...values: number[]) => step(walker({ left: 1 }), 200, seq(...values))
  const back = finish(0.2, 0, 0, 0.5)
  expect(back).toMatchObject({ mode: 'walk', facing: 'left', x: 52 })
  expect(finish(0.6, 0.5)).toMatchObject({ mode: 'pause', left: 4, facing: 'right' })
  expect(finish(0.9, 0.5)).toMatchObject({ mode: 'rest', left: 20 })
})

test('R4・S5・S8: 立ち止まり・休みが終わると、端では内側を向いて歩き出す', () => {
  const resume = (x: number, mode: 'pause' | 'rest', ...values: number[]) =>
    step(walker({ x, mode, left: 1, facing: 'front' }), 100, seq(...values))
  expect(resume(0, 'pause', 0)).toMatchObject({ mode: 'walk', facing: 'right' })
  expect(resume(100, 'rest', 0)).toMatchObject({ mode: 'walk', facing: 'left' })
  expect(resume(50, 'pause', 0.2)).toMatchObject({ mode: 'walk', facing: 'left' })
  expect(resume(50, 'rest', 0.7)).toMatchObject({ mode: 'walk', facing: 'right' })
})

test('R5・S7: 休みの間は向きだけ変わる', () => {
  const resting = walker({ mode: 'rest', left: 10, facing: 'right' })
  expect(step(resting, 100, () => 0.01)).toMatchObject({ x: 50, facing: 'left', left: 9 })
  expect(step(resting, 100, () => 0.07)).toMatchObject({ x: 50, facing: 'right', left: 9 })
  expect(step(resting, 100, () => 0.12)).toMatchObject({ x: 50, facing: 'front', left: 9 })
  expect(step(resting, 100, () => 0.5)).toMatchObject({ x: 50, facing: 'right', left: 9 })
})

test('R6・S4: 立ち止まりの間は向きも位置も変わらない', () => {
  const pausing = walker({ mode: 'pause', left: 5, facing: 'left' })
  for (const r of [0.01, 0.07, 0.12, 0.5]) {
    expect(step(pausing, 100, () => r)).toMatchObject({ x: 50, facing: 'left', mode: 'pause', left: 4 })
  }
})

test('R7: 脚は 2 ピクセルごとに入れ替わり、止まっている間は直立', () => {
  expect([50, 51, 52, 53, 54].map(x => poseOf(walker({ x })))).toEqual(['stepB', 'stepB', 'stepA', 'stepA', 'stepB'])
  expect(poseOf(walker({ mode: 'pause' }))).toBe('stand')
  expect(poseOf(walker({ mode: 'rest' }))).toBe('stand')
})

test('R8: 向きを変えるまでに歩く距離は、幅 600 ピクセルの帯で平均 55〜100 ピクセル', () => {
  const trail = wanderFor(50000, 600)
  const runs: number[] = []
  let run = 0
  let heading: 'left' | 'right' | null = null
  for (let i = 1; i < trail.length; i += 1) {
    const dx = trail[i]!.x - trail[i - 1]!.x
    if (dx === 0) continue
    const now = dx > 0 ? 'right' : 'left'
    if (heading !== null && now !== heading) {
      runs.push(run)
      run = 0
    }
    heading = now
    run += Math.abs(dx)
  }
  const mean = runs.reduce((a, b) => a + b, 0) / runs.length
  expect(runs.length).toBeGreaterThan(500)
  expect(mean).toBeGreaterThanOrEqual(55)
  expect(mean).toBeLessThanOrEqual(100)
})

test('R9・R13・S3: 端を越えるときは位置を変えずに反転し、残り距離が 1 減る', () => {
  expect(step(walker({ x: 99, gait: 'dash', left: 10 }), 100, () => 0.5)).toMatchObject({ x: 99, facing: 'left', left: 9 })
  expect(step(walker({ x: 0, facing: 'left', left: 10 }), 100, () => 0.5)).toMatchObject({ x: 0, facing: 'right', left: 9 })
  // 幅 0 の帯でも、反転し続けずにやがて立ち止まるか休む
  let w = walker({ x: 0, left: 5 })
  const random = lcg(3)
  const modes = new Set<string>()
  for (let i = 0; i < 200; i += 1) {
    w = step(w, 0, random)
    modes.add(w.mode)
    expect(w.x).toBe(0)
  }
  expect(modes.has('pause') || modes.has('rest')).toBe(true)
})

// ---- 顔ぶれ -----------------------------------------------------------------

test('R2・R11: 仲間は現れかけから始まり、種類・色・位置の割り当ては変わらない', () => {
  // 乱数は 1 体ごとに「種類を選ぶ」「位置を選ぶ」の順に使う
  const two = sync(assemble(), ['a', 'b'], seq(0, 0.5, 0, 0.999), 100)
  expect(two.map(m => m.id)).toEqual([MAIN, 'a', 'b'])
  expect(two.slice(1).map(m => m.presence)).toEqual([
    { kind: 'arriving', left: FADE_FRAMES },
    { kind: 'arriving', left: FADE_FRAMES },
  ])
  expect(two.map(m => m.mascot)).toEqual(['clawd', FRIENDS[0], FRIENDS[1]]) // 2 体目は、まだいない種類から選ぶ
  expect(new Set(two.map(m => m.color)).size).toBe(3)
  expect(two[1]!.wanderer.x).toBe(Math.floor(0.5 * (100 - MASCOTS[FRIENDS[0]!].width + 1)))
  expect(two[2]!.wanderer.x).toBe(100 - MASCOTS[FRIENDS[1]!].width) // 右端ぴったりまで
})

test('R8・S8\'・S12・R10: いる仲間は外れると跳ねてから F コマかけて消え、消えきったら顔ぶれから外れる', () => {
  let crew = sync(assemble(), ['a', 'b'], Math.random, 100)
  crew = advanceBy(crew, FADE_FRAMES) // 2 体ともいるになる
  crew = sync(crew, ['b'], Math.random, 100)
  expect(crew.map(m => [m.id, m.presence.kind])).toEqual([[MAIN, 'gone'], ['a', 'leaping'], ['b', 'here']])
  const kept = crew[2]!
  crew = advanceBy(crew, LEAP_FRAMES + FADE_FRAMES)
  expect(crew.map(m => m.id)).toEqual([MAIN, 'b']) // 本体は外さない
  expect(crew[1]!.color).toBe(kept.color) // 残った仲間の色と種類は変わらない
  expect(crew[1]!.mascot).toBe(kept.mascot)
})

test('全種類がそろうまでは同じ種類が出ない', () => {
  const crew = sync(assemble(), FRIENDS.map((_, i) => `a${i}`), Math.random, 200)
  expect(new Set(crew.slice(1).map(m => m.mascot)).size).toBe(FRIENDS.length)
  const more = sync(crew, [...FRIENDS.map((_, i) => `a${i}`), 'extra'], Math.random, 200)
  expect(FRIENDS).toContain(more[more.length - 1]!.mascot)
})

test('起動の知らせで 1 体増え、ほかの仲間の状態はそのまま', () => {
  let crew = advanceBy(sync(assemble(), ['a', 'b'], () => 0, 100), FADE_FRAMES)
  crew = sync(crew, ['b'], () => 0, 100) // a は跳ねてから消える
  const joined = join(crew, 'c', () => 0.5, 100)
  expect(joined.map(m => [m.id, m.presence.kind])).toEqual([
    [MAIN, 'gone'],
    ['a', 'leaping'],
    ['b', 'here'],
    ['c', 'arriving'],
  ])
  expect(agentCount(joined)).toBe(3)
})

test(`サブエージェントは ${MAX_AGENTS} 体まで`, () => {
  const many = sync(assemble(), Array.from({ length: MAX_AGENTS + 5 }, (_, i) => `a${i}`), () => 0, 100)
  expect(agentCount(many)).toBe(MAX_AGENTS)
})

// ---- 出入り（.scratch/fade-in/spec.md） --------------------------------------

test('R1・S1・S6・R4: 本体は作業が始まると降りながら濃くなって現れ、F コマでいるになる', () => {
  let crew = setMain(assemble(), true)
  expect(crew[0]!.presence).toEqual({ kind: 'arriving', left: FADE_FRAMES })
  const opacities: number[] = []
  const lifts: number[] = []
  for (let i = 0; i < FADE_FRAMES; i += 1) {
    const [main] = actors(crew)
    opacities.push(main!.opacity!)
    lifts.push(main!.lift!)
    crew = advanceBy(crew, 1)
  }
  expect(opacities[0]).toBe(0)
  expect(opacities.every((o, i) => i === 0 || o > opacities[i - 1]!)).toBe(true)
  expect(lifts[0]).toBe(4)
  expect(lifts.every((l, i) => i === 0 || l <= lifts[i - 1]!)).toBe(true)
  expect(crew[0]!.presence).toEqual(HERE)
  expect(actors(crew)[0]!.opacity).toBeUndefined()
})

test('R3・R4・R9・S9: 現れかけの間は歩かず、いるになった次のコマから歩く', () => {
  const walking: Crew = [{ ...assemble()[0]!, wanderer: { x: 50, facing: 'right', mode: 'walk', left: 100, gait: 'walk', frame: 0 } }]
  let crew = setMain(walking, true)
  for (let i = 0; i < FADE_FRAMES; i += 1) {
    crew = advanceBy(crew, 1, 200)
    expect(crew[0]!.wanderer.x).toBe(50)
  }
  expect(crew[0]!.presence).toEqual(HERE)
  crew = advanceBy(crew, 1, 200)
  expect(crew[0]!.wanderer.x).toBe(52)
})

test('R5・S5: 現れかけで引っ込めると、その濃さのまま消え始める', () => {
  let crew = advanceBy(setMain(assemble(), true), 3)
  const before = actors(crew)[0]!.opacity!
  crew = setMain(crew, false)
  expect(crew[0]!.presence).toEqual({ kind: 'leaving', left: 3 })
  expect(Math.abs(actors(crew)[0]!.opacity! - before)).toBeLessThan(1e-9)
  // 現れかけた瞬間（濃さ 0）に引っ込めると、その場でいなくなる
  expect(retreat(appear(GONE))).toEqual(GONE)
})

test('R6・S10: 消えかけで出し直すと、その濃さのまま現れ直す', () => {
  let crew = setMain(advanceBy(setMain(assemble(), true), FADE_FRAMES), false)
  crew = advanceBy(crew, LEAP_FRAMES + 4)
  const before = actors(crew)[0]!.opacity!
  crew = setMain(crew, true)
  expect(crew[0]!.presence).toEqual({ kind: 'arriving', left: 4 })
  expect(Math.abs(actors(crew)[0]!.opacity! - before)).toBeLessThan(1e-9)
  // 仲間も同じ。一覧に戻っても、起動の知らせでも、濃さを飛ばさない
  let agents = setMain(advanceBy(sync(assemble(), ['a'], () => 0, 100), FADE_FRAMES), false)
  agents = advanceBy(sync(agents, [], () => 0, 100), LEAP_FRAMES + 5)
  expect(sync(agents, ['a'], () => 0, 100)[1]!.presence).toEqual({ kind: 'arriving', left: 5 })
  expect(join(agents, 'a', () => 0, 100)[1]!.presence).toEqual({ kind: 'arriving', left: 5 })
  // 消え始めた瞬間（濃さ 1）に出し直すと、そのままいる
  expect(appear(retreat(HERE))).toEqual(HERE)
})

test('R7・R12: 現れかけだけでも描くものがあり、全員いなくなると描かない', () => {
  expect(isVisible(setMain(assemble(), true))).toBe(true)
  const crew = advanceBy(setMain(advanceBy(setMain(assemble(), true), FADE_FRAMES), false), LEAP_FRAMES + FADE_FRAMES)
  expect(isVisible(crew)).toBe(false)
  expect(actors(crew)).toHaveLength(0)
})

test('R8・emotes R1・S8\'・S15: 本体は作業が終わると跳ねてから、浮き上がりながら薄くなって消え、顔ぶれには残る', () => {
  let crew = setMain(advanceBy(setMain(assemble(), true), FADE_FRAMES), false)
  const opacities: number[] = []
  const lifts: number[] = []
  while (isVisible(crew)) {
    const [main] = actors(crew)
    opacities.push(main!.opacity!)
    lifts.push(main!.lift!)
    crew = advanceBy(crew, 1)
  }
  expect(opacities).toHaveLength(LEAP_FRAMES + FADE_FRAMES)
  // 跳ねる 4 コマ: 濃さ 1 のまま 1・2・2・1 ピクセル浮く
  expect(opacities.slice(0, LEAP_FRAMES)).toEqual([1, 1, 1, 1])
  expect(lifts.slice(0, LEAP_FRAMES)).toEqual([1, 1, 1, 1])
  // そのあと F コマで薄くなりながら浮き上がる
  const fading = opacities.slice(LEAP_FRAMES)
  expect(fading[0]).toBe(1)
  expect(fading.every((o, i) => i === 0 || o < fading[i - 1]!)).toBe(true)
  expect(lifts[lifts.length - 1]).toBeGreaterThan(0)
  expect(crew.map(m => m.id)).toEqual([MAIN]) // 本体は消えても残り、次の作業で同じ場所に戻る
})

test('R13: 顔ぶれが空でも、本体を補ってから処理する', () => {
  expect(setMain([], true).map(m => [m.id, m.presence.kind])).toEqual([[MAIN, 'arriving']])
  expect(sync([], ['a'], () => 0, 100).map(m => [m.id, m.presence.kind])).toEqual([
    [MAIN, 'gone'],
    ['a', 'arriving'],
  ])
})

test('S2・S3・S4・S7・S11: 何もしない遷移では状態が変わらない', () => {
  expect(retreat(GONE)).toBe(GONE) // S2
  expect(elapse(GONE)).toBe(GONE) // S3
  const arriving = appear(GONE)
  expect(appear(arriving)).toBe(arriving) // S4
  expect(appear(HERE)).toBe(HERE) // S7
  const leaving = retreat(HERE)
  expect(retreat(leaving)).toBe(leaving) // S11
  expect(elapse(HERE)).toBe(HERE) // S9 の出入りの側
})

test('契約 actors: いない者は含まず、現れかけ・消えかけは正面・直立で濃さ 0〜1・浮き 0〜4', () => {
  const states = [setMain(assemble(), true), setMain(advanceBy(setMain(assemble(), true), FADE_FRAMES), false)]
  for (let crew of states) {
    for (let i = 0; i <= FADE_FRAMES; i += 1) {
      for (const actor of actors(crew)) {
        expect(actor.facing).toBe('front')
        expect(actor.pose).toBe('stand')
        expect(actor.opacity).toBeGreaterThanOrEqual(0)
        expect(actor.opacity).toBeLessThanOrEqual(1)
        expect(actor.lift).toBeGreaterThanOrEqual(0)
        expect(actor.lift).toBeLessThanOrEqual(4)
      }
      expect(actors(crew).length).toBe(crew.filter(m => m.presence.kind !== 'gone').length)
      crew = advanceBy(crew, 1)
      if (crew[0]!.presence.kind === 'here') break
    }
  }
})

// ---- 反応（.scratch/emotes/spec.md） --------------------------------------------

/** 指定した位置で歩いている本体を、作業中にして「いる」まで進めたもの */
const hereMain = (x = 50): Crew =>
  advanceBy(
    setMain([{ ...assemble()[0]!, wanderer: { x, facing: 'right', mode: 'walk', left: 1000, gait: 'walk', frame: 0 } }], true),
    FADE_FRAMES,
    200,
  )

/** 帯の行に、その文字（記号）が描かれているか */
const hasChar = (lines: string[], char: string) => lines.some(line => line.includes(char))
/** ピクセルの列 c が「!」（上 4 つ・1 つ空き・1 つ）で、その左の列が空いているか */
const bangAt = (px: boolean[][], c: number) =>
  [0, 1, 2, 3, 5].every(y => px[y]![c]) && !px[4]![c] && px.every(row => !row[c - 1])
const hasBang = (px: boolean[][]) => px[0]!.some((_, c) => c > 0 && bangAt(px, c))

test('R2・S13・S14: 跳ねている間に出し直すといるに戻り、引っ込めても変わらない', () => {
  const leaping = setMain(hereMain(), false)
  expect(leaping[0]!.presence).toEqual({ kind: 'leaping', left: LEAP_FRAMES })
  expect(setMain(leaping, false)[0]!.presence).toEqual(leaping[0]!.presence)
  expect(setMain(advanceBy(leaping, 2), true)[0]!.presence).toEqual(HERE)
})

test('R3・R4・T2: 失敗すると 2 秒驚き、その間は歩かずに「!」を出す。震えるのは最初の 8 コマだけ', () => {
  let crew = poke(hereMain(), MAIN, true)
  expect(crew[0]!.startle).toBe(20)
  for (let i = 0; i < STARTLE_FRAMES; i += 1) {
    const actor = actors(crew)[0]!
    expect(actor.emote).toEqual({ kind: 'startle' })
    expect(Math.abs(actor.x - 50)).toBe(i < 8 ? 1 : 0)
    crew = advanceBy(crew, 1, 200)
    expect(crew[0]!.wanderer.x).toBe(50)
  }
  expect(actors(crew)[0]!.emote).toBeUndefined()
  crew = advanceBy(crew, 1, 200)
  expect(crew[0]!.wanderer.x).toBe(52) // 驚き終わると、また歩く（T4）
})

test('R5・T3: 活動が 60 秒途切れると居眠りし、小さな寝姿で「Z」が上下する', () => {
  let crew = advanceBy(hereMain(), DOZE_FRAMES - 1, 200)
  expect(actors(crew)[0]!.emote).toBeUndefined()
  crew = advanceBy(crew, 1, 200)
  const x = crew[0]!.wanderer.x
  const highs = new Set<boolean>()
  for (let i = 0; i < 20; i += 1) {
    const actor = actors(crew)[0]!
    expect(actor).toMatchObject({ facing: 'front', pose: 'sleep', emote: { kind: 'doze' } })
    highs.add((actor.emote as { high: boolean }).high)
    crew = advanceBy(crew, 1, 200)
    expect(crew[0]!.wanderer.x).toBe(x)
  }
  expect(highs).toEqual(new Set([true, false]))
  // 寝姿: 高さ 4（上 2 行は空き）、幅は元の 8 割以下、足元は下端、左右は中央
  const litColumns = (bitmap: boolean[][]) => bitmap[0]!.map((_, x) => bitmap.some(row => row[x])).flatMap((on, x) => (on ? [x] : []))
  for (const [id, mascot] of Object.entries(MASCOTS)) {
    const sleep = mascot.draw('front', 'sleep')
    const cols = litColumns(sleep)
    expect({ id, top: sleep.slice(0, 2).some(row => row.some(Boolean)) }).toEqual({ id, top: false })
    expect({ id, feet: sleep[5]!.some(Boolean) }).toEqual({ id, feet: true })
    const span = cols[cols.length - 1]! - cols[0]! + 1
    expect({ id, small: span <= mascot.width * 0.8 }).toEqual({ id, small: true })
    const center = (cols[0]! + cols[cols.length - 1]!) / 2
    expect({ id, centered: Math.abs(center - (mascot.width - 1) / 2) <= 1 }).toEqual({ id, centered: true })
  }
})

test('R6: 活動があると居眠りから起きる', () => {
  const dozing = advanceBy(hereMain(), DOZE_FRAMES, 200)
  const awake = poke(dozing, MAIN, false)
  expect(awake[0]!.idle).toBe(0)
  expect(actors(awake)[0]!.emote).toBeUndefined()
})

test('R7: 居眠り中に失敗すると、驚きを描く', () => {
  const dozing = advanceBy(hereMain(), DOZE_FRAMES, 200)
  expect(actors(poke(dozing, MAIN, true))[0]!.emote).toEqual({ kind: 'startle' })
})

test('R8・T1: 出入りの途中は驚きも居眠りも描かない', () => {
  const arriving = setMain(assemble(), true)
  expect(poke(arriving, MAIN, true)[0]!.startle).toBe(0)
  expect(actors(poke(arriving, MAIN, true))[0]!.emote).toBeUndefined()
  let leaving = setMain(advanceBy(hereMain(), DOZE_FRAMES, 200), false)
  for (let i = 0; i < LEAP_FRAMES + FADE_FRAMES - 1; i += 1) {
    expect(actors(leaving)[0]!.emote).toBeUndefined()
    leaving = advanceBy(leaving, 1, 200)
  }
})

test('R10: 顔ぶれにいない id の失敗では、誰も驚かない', () => {
  const crew = hereMain()
  expect(poke(crew, 'nobody', true)).toEqual(crew)
})

test('契約 Actor.emote: 記号は絵の右端の塗りから 1 ピクセル以上空けて描き（! はドット絵、zZ は文字）、帯からはみ出さない', () => {
  const rightEdge = (bitmap: boolean[][]) => Math.max(...bitmap.map(row => row.lastIndexOf(true)))
  const columnAfter = (x: number, bitmap: boolean[][]) => Math.ceil((x + rightEdge(bitmap) + 2) / 2)
  const charAt = (lines: string[], row: number, col: number) => [...lines[row]!][col]
  // 驚き: 絵の右端の塗りから 1 ピクセル空けて、ドット絵の「!」
  const stand = MASCOTS.clawd.draw('front', 'stand')
  const bang = pixels(decode(paint([clawd(0, { emote: { kind: 'startle' } })], 11), 11).lines)
  expect(bangAt(bang, rightEdge(stand) + 2)).toBe(true)
  // 居眠り: 「z」とその右上に「Z」。high で 1 行上。絵の塗りとは重ならない（位置が奇数でも偶数でも）
  const sleep = MASCOTS.clawd.draw('front', 'sleep')
  for (const x of [0, 1]) {
    const col = columnAfter(x, sleep)
    expect(col * 2).toBeGreaterThan(x + rightEdge(sleep))
    const dozing = (high: boolean) => decode(paint([clawd(x, { pose: 'sleep', emote: { kind: 'doze', high } })], 13), 13).lines
    const high = dozing(true)
    const low = dozing(false)
    expect([charAt(high, 1, col), charAt(high, 0, col + 1)]).toEqual(['z', 'Z'])
    expect([charAt(low, 2, col), charAt(low, 1, col + 1)]).toEqual(['z', 'Z'])
  }
  // 帯の右端では記号は描かれないだけで、行の長さは変わらない
  const edge = decode(paint([clawd(2, { emote: { kind: 'startle' } })], 10), 10)
  expect(edge.lines.every(line => [...line].length === 10)).toBe(true)
})

test('emotes の R4: 「!」は持ち主の色ではなく赤で描く', () => {
  const cells = paint([clawd(0, { emote: { kind: 'startle' } })], 16)
  expect(cellColors(cells).has(BANG_COLOR)).toBe(true)
  expect(BANG_COLOR).toBe(0xe04f4f)
  // 「!」の列（絵の右端の塗り 16 + 2 = 18 ピクセル目 → マス 9）は赤で、本体の橙は混ざらない
  const words = new Uint32Array(Uint8Array.from(atob(cells), c => c.charCodeAt(0)).buffer)
  for (let row = 0; row < SPRITE_ROWS; row += 1) {
    const at = (row * 16 + 9) * 3
    if (words[at] !== 0x20) expect(words[at + 1]).toBe(BANG_COLOR)
  }
})

test('register: ツールの呼び出しが失敗すると、本体が「!」を出す', NO_PLAY, async ($, on) => {
  const clock = mock.clock(on)
  beneath(on)
  on('agent.list', async () => ({ value: [] }))
  on('tool.call', async () => ({ deny: 'refused by the test' }) as never)
  const frames: string[] = []
  on('ui.blit', async (_$, e) => {
    if ('cells' in e) frames.push(e.cells)
    return { value: {} }
  })
  const ui = await $.ui.mount({ ...band(true, 40), surface: 'terminal' })
  await clock.advance(1500) // 現れきる
  expect(hasBang(pixels(decode(frames[frames.length - 1]!, 40).lines))).toBe(false)
  await $.tool.call({ tool: 'Read', file_path: 'a.md' })
  await clock.advance(200)
  expect(hasBang(pixels(decode(frames[frames.length - 1]!, 40).lines))).toBe(true)
  await ui.unmount()
})

// ---- 道具（.scratch/props/spec.md） -------------------------------------------

const litCount = (lines: string[]) => pixels(lines).flat().filter(Boolean).length

test('契約 propFor・R1・R2・R3・R17〜R20: ツール名（と Bash のコマンド）から道具を決める', () => {
  for (const tool of ['Edit', 'MultiEdit', 'NotebookEdit']) expect(propFor(tool)).toBe('hammer')
  for (const tool of ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch']) expect(propFor(tool)).toBe('magnifier')
  expect(propFor('Agent')).toBe('flag') // R17
  for (const tool of ['Monitor', 'ScheduleWakeup']) expect(propFor(tool)).toBe('hourglass') // R18
  expect(propFor('Write')).toBe('pencil') // R19
  expect(propFor('Bash', 'npm test')).toBe('flask') // R20
  for (const tool of ['Bash', 'AskUserQuestion', 'mcp__x__y', 'toString', 'constructor']) expect(propFor(tool)).toBeNull()
  expect(propFor('Bash', 'git status')).toBeNull()
  expect(propFor('Bash', 42)).toBeNull() // コマンドが文字列でなければテストではない
  expect(propFor('Read', 'npm test')).toBe('magnifier') // Bash 以外ではコマンドを見ない
})

test('R20: テストを走らせるコマンドの判定', () => {
  const tests = [
    'npm test',
    'go test ./...',
    'cargo test --release',
    'claude plugin test clawd-wander',
    'make test',
    'pytest -q',
    'npx vitest run',
    'python -m pytest tests/',
    'bunx jest --watch=false',
    'cd app && npm test',
    'git status; yarn test',
    'npm run build | tee log && rspec',
    'CI=1 npm test',
    'npm test -- -t "renders"',
    'vendor/bin/phpunit', // パス付きのテストの実行コマンド
    './node_modules/.bin/jest --ci',
    'npm run test:unit', // test: で始まるスクリプト
    'pnpm test:e2e',
    "cat > t.txt <<'EOF'\nhello\nEOF\nnpm test", // heredoc のあとのコマンドは数える
    "cat <<'EOF' | pytest -\nx\nEOF", // heredoc の始まりの行の残りは数える
    'cat <<< "hello"\nnpm test', // ヒアストリング <<< は heredoc ではない
    '(cd app && npm test)', // 括弧でも区切る
    'npx jest@29 --ci', // バージョン付きの名前
    'tox -e py311', // 2026-10-08 に追加した名前
    'uvx tox',
    'cargo nextest run',
    'node --test', // --test
    'LC_ALL=C npm test', // 先頭の環境変数の設定は飛ばす
    'mkdir -p out && pytest', // 除外するコマンドの区切りのあとは数える
  ]
  const others = [
    'ls',
    'git status',
    'test -f a.txt',
    'cat tests/a.test.ts',
    'echo contest',
    'npm run build',
    'grep -r test src',
    'echo test',
    'rg test',
    'git commit -m "run test now"', // 引用符の中は数えない
    "gh pr create --title 'add test' --body 'see jest'",
    "cat > t.py <<'EOF'\nimport unittest\nEOF", // heredoc の本文は数えない
    "gh pr create --body-file - <<'EOF'\n- [ ] run the test suite\nEOF",
    'git commit -m "$(cat <<\'EOF\'\nfix "run the test suite" hang\nEOF\n)"',
    'cat <<-EOF\n\trun test now\n\tEOF',
    'if test -f a; then echo ok; fi', // if・! のあとの test はシェルの条件判定
    '! test -f a',
    'git commit -m "first line \\\nrun the test suite"', // 引用符の中の \ と改行
    'npm run build & echo test', // 単独の & でも区切る
    '',
    'mkdir test', // ファイル・ブランチの名前を扱うだけのコマンド
    'cd test && ls',
    'git checkout test',
    'git grep test',
    'rm -rf test',
    'touch test',
    'LC_ALL=C grep -r test src', // 先頭の環境変数の設定を飛ばして 1 語目を見る
    'pip install pytest', // 道具を入れる・外すだけ
    'python -m pip install pytest',
    'npm i -D vitest',
    'npm install --save-dev jest',
    'yarn add -D jest',
    'cargo install cargo-nextest',
    'composer require --dev phpunit/phpunit',
  ]
  expect(tests.filter(c => !runsTests(c))).toEqual([])
  expect(others.filter(c => runsTests(c))).toEqual([])
})

const FLAG_RED = 0xe04f4f
const FLASK_GLASS = 0xc8d0d8
const FLASK_LIQUID = 0x5cd67a
const PENCIL_YELLOW = 0xf2c94c
const HOURGLASS_FRAME = 0xb08850

test('R22・契約 propPixels: どの道具も道具の色で塗る', () => {
  const owner = 0x123456
  const colorsOf = (kind: Parameters<typeof propPixels>[0]) =>
    new Set(propPixels(kind, 'right', owner).flat().filter(color => color !== null))
  expect(colorsOf('hammer')).toEqual(new Set([0x5a606b, 0xd6a86e]))
  expect(colorsOf('magnifier')).toEqual(new Set([0xc0c6cc, 0xa0703c]))
  expect(colorsOf('flag')).toEqual(new Set([0x9a9a9a, FLAG_RED]))
  expect(colorsOf('flask')).toEqual(new Set([FLASK_GLASS, FLASK_LIQUID]))
  expect(colorsOf('pencil')).toEqual(new Set([0xf08fa8, PENCIL_YELLOW, 0xe8b98a, 0x444444]))
  expect(colorsOf('hourglass')).toEqual(new Set([HOURGLASS_FRAME, 0xf2d27a]))
  // 高さはどれも 6、左に持つと左右反転、行列の張り出しは 1 + 幅（旗 7・フラスコ 7・鉛筆 3・砂時計 6）
  for (const [kind, width] of [['flag', 6], ['flask', 6], ['pencil', 2], ['hourglass', 5]] as const) {
    const right = propPixels(kind, 'right', owner)
    expect({ kind, size: [right.length, right[0]!.length] }).toEqual({ kind, size: [6, width] })
    expect(propPixels(kind, 'left', owner)).toEqual(right.map(row => [...row].reverse()))
    expect(reach(grab(null, kind))).toBe(1 + width)
  }
})

test('R22: 1 マスがちょうど 2 色で空きが無ければ、多いほうを文字の色、少ないほうを背景の色にする', () => {
  // 本体（x = 0、右向き）がフラスコを持つ。フラスコの胴（4・5 行目）でガラスと液体が 1 マスに入る
  const cells = paint([clawd(0, { facing: 'right', pose: 'stepA', prop: { kind: 'flask', side: 'right', raised: false } })], 16)
  const words = new Uint32Array(Uint8Array.from(atob(cells), c => c.charCodeAt(0)).buffer)
  const pairs = new Set<string>()
  for (let at = 0; at < words.length; at += 3) if (words[at + 2] !== 0x01000000) pairs.add(`${words[at + 1]!.toString(16)}/${words[at + 2]!.toString(16)}`)
  expect([...pairs].some(pair => pair.split('/').sort().join('/') === [FLASK_GLASS, FLASK_LIQUID].map(c => c.toString(16)).sort().join('/'))).toBe(true)
  // 本体だけのマスは今までどおり背景を塗らない
  const plain = new Uint32Array(Uint8Array.from(atob(paint([clawd(0)], 16)), c => c.charCodeAt(0)).buffer)
  expect([...plain].filter((_, i) => i % 3 === 2).every(color => color === 0x01000000)).toBe(true)
})

test('R1・R2・S1・S5・契約 wield: 呼び出し元だけが持ち、使っている数が増え、途切れは 0 に戻る', () => {
  const crew = advanceBy(sync(advanceBy(hereMain(), 50, 200), ['a'], () => 0, 200), FADE_FRAMES + 30, 200)
  expect(crew[1]!.idle).toBeGreaterThan(0)
  const snapshot = JSON.stringify(crew)
  const held = wield(crew, 'a', 'Edit')
  release(crew, 'a', 'Edit')
  expect(JSON.stringify(crew)).toBe(snapshot) // crew を変更しない
  expect(held[1]!.prop).toEqual({ kind: 'hammer', using: 1, left: PROP_FRAMES, held: 0, next: null }) // S1
  expect(held[1]!.idle).toBe(0)
  expect(held[0]!.prop).toBeNull()
  // S5・S14: 持ち替えてから 1.5 秒たつまでは、今の道具のまま持ち替えを待つ（R23）
  expect(wield(held, 'a', 'Grep')[1]!.prop).toEqual({ kind: 'hammer', using: 2, left: PROP_FRAMES, held: 0, next: 'magnifier' })
})

test('R3・R10: 対応しないツールや、いない id では、始まりも終わりも何も変えない', () => {
  const held = wield(hereMain(), MAIN, 'Edit')
  expect(wield(held, MAIN, 'Bash')).toBe(held)
  expect(release(held, MAIN, 'Bash')).toBe(held)
  expect(wield(held, 'nobody', 'Edit')).toEqual(held)
  expect(release(held, 'nobody', 'Edit')).toEqual(held)
})

test('R11・S2・S6・S10・契約 release: 終わると使っている数が減り（0 より下げない）、残りが 100 コマになる', () => {
  expect(PROP_FRAMES).toBe(100)
  const twice = wield(wield(hereMain(), MAIN, 'Read'), MAIN, 'Read')
  expect(release(twice, MAIN, 'Read')[0]!.prop).toEqual({ kind: 'magnifier', using: 1, left: PROP_FRAMES, held: 0, next: null }) // S6 n ≥ 2
  const busy = advanceBy(wield(hereMain(), MAIN, 'Edit'), 30, 200)
  expect(busy[0]!.idle).toBeGreaterThan(0)
  const once = release(busy, MAIN, 'Edit')
  expect(once[0]!.prop).toEqual({ kind: 'hammer', using: 0, left: PROP_FRAMES, held: SWAP_FRAMES, next: null }) // S6 n = 1
  expect(once[0]!.idle).toBe(0) // 途切れも 0 に戻る
  expect(release(hereMain(), MAIN, 'Grep')[0]!.prop).toEqual({ kind: 'magnifier', using: 0, left: PROP_FRAMES, held: 0, next: null }) // S2
  const lingering = advanceBy(once, 40, 200)
  expect(release(lingering, MAIN, 'Read')[0]!.prop).toEqual({ kind: 'magnifier', using: 0, left: PROP_FRAMES, held: 0, next: null }) // S10・S16 持ち替えて数え直す
})

test('R12・S7・S9: 使っている間は何コマ進んでも残りが減らず、余韻の途中で始まれば使用中に戻る', () => {
  const using = advanceBy(wield(hereMain(), MAIN, 'WebFetch'), PROP_FRAMES * 3, 200)
  expect(using[0]!.prop).toEqual({ kind: 'magnifier', using: 1, left: PROP_FRAMES, held: SWAP_FRAMES, next: null }) // S7
  const lingering = advanceBy(release(using, MAIN, 'WebFetch'), 60, 200)
  expect(lingering[0]!.prop).toEqual({ kind: 'magnifier', using: 0, left: PROP_FRAMES - 60, held: SWAP_FRAMES, next: null })
  expect(wield(lingering, MAIN, 'Edit')[0]!.prop).toEqual({ kind: 'hammer', using: 1, left: PROP_FRAMES, held: 0, next: null }) // S9・S16
})

test('R4・S3・S11: 使い終えてから 100 コマで道具をしまう', () => {
  const done = release(wield(hereMain(), MAIN, 'Read'), MAIN, 'Read')
  expect(advanceBy(done, PROP_FRAMES - 1, 200)[0]!.prop).toEqual({ kind: 'magnifier', using: 0, left: 1, held: SWAP_FRAMES, next: null })
  expect(advanceBy(done, PROP_FRAMES, 200)[0]!.prop).toBeNull()
  expect(advanceBy(hereMain(), 1, 200)[0]!.prop).toBeNull() // S3
})

test('契約 grab・relax・decay・Grip: 数は 0 より下がらず、残りは使い終えてから 1 コマずつ減る', () => {
  const g = grab(null, 'hammer')
  expect(g).toEqual({ kind: 'hammer', using: 1, left: PROP_FRAMES, held: 0, next: null })
  expect(grab(g, 'magnifier')).toEqual({ kind: 'hammer', using: 2, left: PROP_FRAMES, held: 0, next: 'magnifier' })
  expect(relax(null, 'hammer')).toEqual({ kind: 'hammer', using: 0, left: PROP_FRAMES, held: 0, next: null })
  expect(relax(relax(g, 'hammer'), 'hammer')).toEqual({ kind: 'hammer', using: 0, left: PROP_FRAMES, held: 0, next: null }) // 0 より下げない
  expect(grab(g, 'hammer', 30).left).toBe(30) // 残りは frames で決める（config の R2）
  expect(relax(g, 'hammer', 30).left).toBe(30)
  expect(decay(g)).toEqual({ ...g, held: 1 }) // 使っている間は残りを減らさない
  const lingering = { kind: 'hammer', using: 0, left: 2, held: SWAP_FRAMES, next: null } as const
  expect(decay(lingering)).toEqual({ ...lingering, left: 1 })
  expect(decay({ ...lingering, left: 1 })).toBeNull()
  expect(decay(null)).toBeNull()
  expect(g).toEqual({ kind: 'hammer', using: 1, left: PROP_FRAMES, held: 0, next: null }) // 引数を変更しない
})

test('契約 PROP_GAP・reach: 張り出しは、持っていなければ 0、ハンマー 6、虫めがね 7', () => {
  expect(PROP_GAP).toBe(1)
  expect(reach(null)).toBe(0)
  expect(reach(grab(null, 'hammer'))).toBe(6)
  expect(reach(relax(null, 'magnifier'))).toBe(7)
})

test('R14・R15・S4・S8・S12: 消えきるとしまい、消えきっている 1 体には持たせない', () => {
  const vanish = (crew: Crew) => advanceBy(setMain(crew, false), LEAP_FRAMES + FADE_FRAMES, 200)
  const using = vanish(wield(hereMain(), MAIN, 'Edit'))
  expect(using[0]!.presence).toEqual(GONE)
  expect(using[0]!.prop).toBeNull() // S8: 終わりが届かないまま消えきっても、持ちっぱなしにならない
  expect(vanish(release(wield(hereMain(), MAIN, 'Edit'), MAIN, 'Edit'))[0]!.prop).toBeNull() // S12
  expect(vanish(hereMain())[0]!.prop).toBeNull() // S4
  expect(wield(using, MAIN, 'Edit')[0]!.prop).toBeNull() // R15
  expect(release(using, MAIN, 'Edit')[0]!.prop).toBeNull()
  // 現れかけたばかりで引っ込めると、その場で消えきる。そのときも道具をしまう
  expect(setMain(wield(setMain(assemble(), true), MAIN, 'Edit'), false)[0]!).toMatchObject({ presence: GONE, prop: null })
})

test('R5・T4: 右向きは右に、左向きは左に反転して、絵の端から 1 ピクセル空けて描く', () => {
  const right = actors(wield(hereMain(), MAIN, 'Edit'))[0]!
  expect(right.prop).toMatchObject({ kind: 'hammer', side: 'right' })
  const leftCrew: Crew = [{ ...wield(hereMain(), MAIN, 'Read')[0]!, wanderer: { x: 50, facing: 'left', mode: 'rest', left: 50, gait: 'walk', frame: 0 } }]
  expect(actors(leftCrew)[0]!.prop).toMatchObject({ kind: 'magnifier', side: 'left' })

  const stand = MASCOTS.clawd.draw('right', 'stepA')
  const lit = stand.flatMap(row => row.flatMap((on, i) => (on ? [i] : [])))
  // 右: ハンマーの頭（上 2 行・幅 5）が右端の塗り + 2 から始まる
  const r = pixels(decode(paint([clawd(0, { facing: 'right', pose: 'stepA', prop: { kind: 'hammer', side: 'right', raised: false } })], 20), 20).lines)
  const hx = Math.max(...lit) + 2
  expect([0, 1, 2, 3, 4].map(dx => r[0]![hx + dx])).toEqual([true, true, true, true, true])
  expect(r[0]![hx - 1]).toBe(false)
  // 左: 反転した虫めがね（柄が左下）が左端の塗り − 1 で終わる
  const l = pixels(decode(paint([clawd(20, { facing: 'left', pose: 'stepA', prop: { kind: 'magnifier', side: 'left', raised: false } })], 20), 20).lines)
  const mx = 20 + Math.min(...lit) - 1 - 6
  expect(l[5]![mx]).toBe(true) // 反転した柄の先
  expect(l[1]![mx + 5]).toBe(true) // レンズの右端
  expect(l[1]![mx + 6]).toBe(false) // 絵との間は 1 ピクセル空く
})

test('R21: 向いている側で帯からはみ出すときは、反対の手に持ち替えて切らずに描く', () => {
  const held = (x: number, facing: 'left' | 'right', side: 'left' | 'right') =>
    clawd(x, { facing, pose: 'stepA', prop: { kind: 'hammer', side, raised: false } })
  const draw = (actor: Actor, columns: number) => pixels(decode(paint([actor], columns), columns).lines)
  // 左端で左を向くと、右の手に（右に持つ向きの絵で）持つ
  expect(draw(held(0, 'left', 'left'), 20)).toEqual(draw(held(0, 'left', 'right'), 20))
  // 右端で右を向くと、左の手に持つ（帯は 40 ピクセル、絵の幅は 18）
  expect(draw(held(22, 'right', 'right'), 20)).toEqual(draw(held(22, 'right', 'left'), 20))
  // 収まるときは向いている側のまま
  expect(draw(held(10, 'left', 'left'), 20)).not.toEqual(draw(held(10, 'left', 'right'), 20))
  // どちらにも収まらない狭い帯（20 ピクセル）では、向いている側（右）に描いてはみ出す分を切る。
  // ハンマーの頭（1 行目）が右端の列 19 にだけ残り、絵の左の空き列 0 には描かない
  const narrow = draw(held(1, 'right', 'right'), 10)
  expect([narrow[0]![19], narrow[0]![0]]).toEqual([true, false])
})

test('R6・R7: 持ったまま歩き、ハンマーは脚のコマに合わせて上下する', () => {
  let crew = wield(hereMain(), MAIN, 'Edit')
  const raised = new Set<boolean>()
  for (let i = 0; i < 8; i += 1) {
    const actor = actors(crew)[0]!
    raised.add(actor.prop!.raised)
    expect(actor.prop!.raised).toBe(actor.pose === 'stepB')
    crew = advanceBy(crew, 1, 200)
  }
  expect(raised).toEqual(new Set([true, false]))
  expect(crew[0]!.wanderer.x).toBeGreaterThan(50) // 持っていても歩く
  // 虫めがねは上下しない
  const looking = wield(hereMain(), MAIN, 'Grep')
  for (let i = 0, c = looking; i < 8; i += 1, c = advanceBy(c, 1, 200)) expect(actors(c)[0]!.prop!.raised).toBe(false)
  // 上げたハンマーは 1 ピクセル上に描く（柄の下端が 1 行上がる）
  const at = (raisedFlag: boolean) =>
    pixels(decode(paint([clawd(0, { prop: { kind: 'hammer', side: 'right', raised: raisedFlag } })], 20), 20).lines)
  const handle = 16 + 2 + 2
  expect(at(false)[4]![handle]).toBe(true)
  expect(at(true)[4]![handle]).toBe(false)
  expect(at(true)[3]![handle]).toBe(true)
})

test('R8・T1・T2・T3・T5: 驚き中・居眠り中・出入り中・道具が無いときは描かない', () => {
  expect(actors(poke(wield(hereMain(), MAIN, 'Edit'), MAIN, true))[0]!.prop).toBeUndefined() // T2
  expect(actors(wield(setMain(assemble(), true), MAIN, 'Edit'))[0]!.prop).toBeUndefined() // T1 現れかけ
  expect(actors(setMain(wield(hereMain(), MAIN, 'Edit'), false))[0]!.prop).toBeUndefined() // T1 跳ねる
  const leaving = advanceBy(setMain(wield(hereMain(), MAIN, 'Edit'), false), LEAP_FRAMES, 200)
  expect(leaving[0]!.presence.kind).toBe('leaving')
  expect(actors(leaving)[0]!.prop).toBeUndefined() // T1 消えかけ
  expect(actors(hereMain())[0]!.prop).toBeUndefined() // T3
  // 驚いている間も、残りは減り続ける
  const startled = advanceBy(poke(release(wield(hereMain(), MAIN, 'Edit'), MAIN, 'Edit'), MAIN, true), 5, 200)
  expect(startled[0]!.prop).toEqual({ kind: 'hammer', using: 0, left: PROP_FRAMES - 5, held: 5, next: null })
  expect(actors(startled)[0]!.prop).toBeUndefined()
  // T5: 使ったまま 60 秒たつと、道具を持ったまま居眠りし、道具は描かない
  const dozing = advanceBy(wield(hereMain(), MAIN, 'Edit'), DOZE_FRAMES, 200)
  expect(dozing[0]!.prop).not.toBeNull()
  expect(actors(dozing)[0]!).toMatchObject({ pose: 'sleep' })
  expect(actors(dozing)[0]!.prop).toBeUndefined()
})

test('register: Edit の呼び出しで本体がハンマーを持つ', NO_PLAY, async ($, on) => {
  const clock = mock.clock(on)
  beneath(on)
  on('agent.list', async () => ({ value: [] }))
  on('tool.call', async () => ({ result: 'ok' }) as never)
  const frames: string[] = []
  on('ui.blit', async (_$, e) => {
    if ('cells' in e) frames.push(e.cells)
    return { value: {} }
  })
  const ui = await $.ui.mount({ ...band(true, 60), surface: 'terminal' })
  await clock.advance(1500) // 現れきる
  const before = litCount(decode(frames[frames.length - 1]!, 60).lines)
  await $.tool.call({ tool: 'Edit', file_path: 'a.md', old_string: 'a', new_string: 'b' } as never)
  await clock.advance(200)
  const after = litCount(decode(frames[frames.length - 1]!, 60).lines)
  expect(after - before).toBeGreaterThanOrEqual(8) // ハンマーの分（上げていれば頭の 1 行が切れる）
  await ui.unmount()
})

test('register・R22: 4 つの道具はどれも、道具の色で帯に描かれ、エンジンが受け付ける', NO_PLAY, async ($, on) => {
  const clock = mock.clock(on)
  beneath(on)
  on('agent.list', async () => ({ value: [] }))
  on('tool.call', async () => ({ result: 'ok' }) as never)
  const ui = await $.ui.mount({ ...band(true, 60), surface: 'terminal' })
  await clock.advance(1500) // 現れきる
  const calls = [
    [{ tool: 'Agent', description: 'd', prompt: 'p' }, FLAG_RED],
    [{ tool: 'Monitor', command: 'true', description: 'd', timeout_ms: 1000 }, HOURGLASS_FRAME],
    [{ tool: 'Write', file_path: 'a.md', content: 'x' }, PENCIL_YELLOW],
    [{ tool: 'Bash', command: 'npm test' }, FLASK_GLASS],
  ] as const
  for (const [input, color] of calls) {
    await $.tool.call(input as never)
    await clock.advance(1600) // 前の道具から持ち替えるのを待つ（R23）
    await ui.redraw(bandProps(true, 60)) // 道具を持ったまま帯を描き直させる。受け付けなければ描画ごと拒否される
    const found = await ui.find({ key: 'clawd' })
    const tool = (input as { tool: string }).tool
    expect({ tool, raster: found?.type, drawn: cellColors(String(found?.props.cells)).has(color) }).toEqual({ tool, raster: 'Raster', drawn: true })
  }
  await ui.unmount()
})

test('register・R17・R20・R11: Agent で旗、テストを走らせる Bash でフラスコを持ち、ほかの Bash では持たない', NO_PLAY, async ($, on) => {
  const clock = mock.clock(on)
  beneath(on)
  on('agent.list', async () => ({ value: [] }))
  on('tool.call', async () => ({ result: 'ok' }) as never)
  const frames: string[] = []
  on('ui.blit', async (_$, e) => {
    if ('cells' in e) frames.push(e.cells)
    return { value: {} }
  })
  /** 直近 5 秒（50 コマ）のどれかに、道具の色 color が描かれているか（帯の端で向きを変えても切れない。R21） */
  const shownLately = (color: number) => frames.slice(-50).some(cells => cellColors(cells).has(color))
  const ui = await $.ui.mount({ ...band(true, 60), surface: 'terminal' })
  await clock.advance(1500) // 現れきる
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  await clock.advance(5000)
  expect([FLAG_RED, FLASK_GLASS, PENCIL_YELLOW, HOURGLASS_FRAME].filter(shownLately)).toEqual([]) // テストを走らせない Bash（R3）
  await $.tool.call({ tool: 'Agent', description: 'd', prompt: 'p' } as never)
  await clock.advance(3000)
  expect(shownLately(FLAG_RED)).toBe(true) // 旗（R17）
  // 旗を持ったまま帯を描き直させても、エンジンは色付きの帯を受け付ける
  await ui.redraw(bandProps(true, 60))
  expect((await ui.find({ key: 'clawd' }))?.type).toBe('Raster')
  await clock.advance(16000)
  expect(shownLately(FLAG_RED)).toBe(false)
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  await clock.advance(3000)
  expect(shownLately(FLASK_GLASS)).toBe(true) // フラスコ（R20）
  await clock.advance(13000)
  expect(shownLately(FLASK_GLASS)).toBe(false) // 終わりでも同じコマンドで使い終え、10 秒でしまう（R11）
  await ui.unmount()
})

/**
 * 直近 5 秒（50 コマ）のどれかで、本体だけのときより 8 ピクセル以上多く塗られているか（道具を持っているか）。
 * 帯の端で外を向いて休む間（最長 30 コマ）は道具が帯の外に切れるので、休みより長く見る
 */
const heldLately = (frames: string[], before: number, columns: number) =>
  frames.slice(-50).some(cells => litCount(decode(cells, columns).lines) - before >= 8)

test('register・R12・R11・R4: 10 秒を超える呼び出しの間も持ち続け、終わってから 10 秒でしまう', NO_PLAY, async ($, on) => {
  const clock = mock.clock(on)
  beneath(on)
  on('agent.list', async () => ({ value: [] }))
  // 呼び出しは、テストが finish を呼ぶまで終わらない
  let finish: (result: unknown) => void = () => undefined
  on('tool.call', () => new Promise(resolve => (finish = resolve)) as never)
  const frames: string[] = []
  on('ui.blit', async (_$, e) => {
    if ('cells' in e) frames.push(e.cells)
    return { value: {} }
  })
  const ui = await $.ui.mount({ ...band(true, 60), surface: 'terminal' })
  await clock.advance(1500) // 現れきる
  const before = litCount(decode(frames[frames.length - 1]!, 60).lines)
  const call = $.tool.call({ tool: 'WebFetch', url: 'https://example.com', prompt: 'p' } as never)
  await clock.advance(16000)
  expect(heldLately(frames, before, 60)).toBe(true) // 始まってから 11〜16 秒、まだ使っている
  await clock.advance(500)
  finish({ result: 'ok' }) // 16.5 秒で呼び出しが終わる
  await call
  await clock.advance(9400)
  expect(heldLately(frames, before, 60)).toBe(true) // 終わってから 4.5〜9.4 秒
  await clock.advance(6000)
  expect(heldLately(frames, before, 60)).toBe(false) // 終わってから 10.5〜15.4 秒
  await ui.unmount()
})

test('register・R13: 呼び出しが例外で抜けても、持ちっぱなしにならない', NO_PLAY, async ($, on) => {
  const clock = mock.clock(on)
  beneath(on)
  on('agent.list', async () => ({ value: [] }))
  on('tool.call', async () => {
    throw new Error('broken by the test')
  })
  const frames: string[] = []
  on('ui.blit', async (_$, e) => {
    if ('cells' in e) frames.push(e.cells)
    return { value: {} }
  })
  const ui = await $.ui.mount({ ...band(true, 60), surface: 'terminal' })
  await clock.advance(1500) // 現れきる
  const before = litCount(decode(frames[frames.length - 1]!, 60).lines)
  await $.tool.call({ tool: 'Read', file_path: '/nonexistent/clawd-wander-test.md' } as never).catch(() => undefined)
  await clock.advance(5000)
  expect(heldLately(frames, before, 60)).toBe(true) // 終わってから 0〜5 秒
  await clock.advance(11000)
  expect(heldLately(frames, before, 60)).toBe(false) // 終わってから 11〜16 秒
  await ui.unmount()
})

test(
  'register・R16: 呼び出しが中断されたら、その時点で使い終えたとみなし、10 秒でしまう',
  {
    ...NO_PLAY,
    plugins: [
      {
        name: 'interrupter',
        tier: 'prepend',
        // Esc の代わり。3 秒たったら、下の呼び出しを待たずに答えて中断させる
        register(on) {
          on('tool.call', async ($, e, next) => {
            next(e).catch(() => undefined)
            await $.clock.sleep(3000)
            return { deny: 'interrupted by the test' }
          })
        },
      },
    ],
  },
  async ($, on) => {
    const clock = mock.clock(on)
    beneath(on)
    on('agent.list', async () => ({ value: [] }))
    on('tool.call', () => new Promise(() => undefined) as never) // 呼び出しは自分では終わらない
    const frames: string[] = []
    on('ui.blit', async (_$, e) => {
      if ('cells' in e) frames.push(e.cells)
      return { value: {} }
    })
    const ui = await $.ui.mount({ ...band(true, 60), surface: 'terminal' })
    await clock.advance(1500) // 現れきる
    const before = litCount(decode(frames[frames.length - 1]!, 60).lines)
    const call = $.tool.call({ tool: 'WebFetch', url: 'https://example.com', prompt: 'p' } as never)
    await clock.advance(3000) // 中断される
    await call
    await clock.advance(9000)
    expect(heldLately(frames, before, 60)).toBe(true) // 中断から 4〜9 秒
    await clock.advance(7000)
    expect(heldLately(frames, before, 60)).toBe(false) // 中断から 11〜16 秒
    await ui.unmount()
  },
)

test('register・R11・R8: 拒否されても使い終えたとみなし、驚き終えてから見せて、10 秒でしまう', NO_PLAY, async ($, on) => {
  const clock = mock.clock(on)
  beneath(on)
  on('agent.list', async () => ({ value: [] }))
  on('tool.call', async () => ({ deny: 'refused by the test' }) as never)
  const frames: string[] = []
  on('ui.blit', async (_$, e) => {
    if ('cells' in e) frames.push(e.cells)
    return { value: {} }
  })
  const ui = await $.ui.mount({ ...band(true, 60), surface: 'terminal' })
  await clock.advance(1500) // 現れきる
  const before = litCount(decode(frames[frames.length - 1]!, 60).lines)
  await $.tool.call({ tool: 'Edit', file_path: 'a.md', old_string: 'a', new_string: 'b' } as never)
  await clock.advance(1500)
  expect(heldLately(frames, before, 60)).toBe(false) // 驚いている 2 秒は描かない
  await clock.advance(5500)
  expect(heldLately(frames, before, 60)).toBe(true) // 驚き終えた 2〜7 秒
  await clock.advance(9000)
  expect(heldLately(frames, before, 60)).toBe(false) // 終わってから 11〜16 秒
  await ui.unmount()
})

// ---- 帯への描画 ---------------------------------------------------------------

test('Claude が待機中なら何も描かない', NO_PLAY, async ($, on) => {
  beneath(on)
  const ui = await $.ui.mount({ ...band(false), surface: 'terminal' })
  expect(await ui.find({ key: 'clawd' })).toBeUndefined()
  await ui.unmount()
})

test('作業中はプロンプト上の帯に Clawd を描き、ほかの mod の分も残す', NO_PLAY, async ($, on) => {
  mock.clock(on)
  beneath(on)
  const ui = await $.ui.mount({ ...band(true, 40), surface: 'terminal' })
  const found = await ui.find({ key: 'clawd' })
  expect(found?.type).toBe('Raster')
  expect(found?.props).toMatchObject({ columns: 40, rows: SPRITE_ROWS })
  expect(await ui.find({ key: 'beneath' })).toBeDefined()
  await ui.unmount()
})

test('作業中は歩き回り、作業が終わると止まる', NO_PLAY, async ($, on) => {
  const clock = mock.clock(on)
  beneath(on)
  on('agent.list', async () => ({ value: [] }))
  const frames: string[] = []
  on('ui.blit', async (_$, e) => {
    if ('cells' in e) frames.push(e.cells)
    return { value: {} }
  })
  const ui = await $.ui.mount({ ...band(true, 40), surface: 'terminal' })
  await clock.advance(3000)
  expect(frames.length).toBeGreaterThan(20)
  expect(new Set(frames).size).toBeGreaterThan(3)

  // 作業が終わってもすぐには消えず、ふわっと消えてから止まる
  await ui.redraw(bandProps(false, 40))
  await clock.advance(500)
  expect(await ui.find({ key: 'clawd' })).toBeDefined()
  await clock.advance(1500)
  expect(await ui.find({ key: 'clawd' })).toBeUndefined()
  const stopped = frames.length
  await clock.advance(2000)
  expect(frames.length).toBe(stopped)
  await ui.unmount()
})

test('R1: サブエージェントが動いている間は、本体の作業が終わっても本体も仲間も残り、仲間が終わると本体も消える', NO_PLAY, async ($, on) => {
  const clock = mock.clock(on)
  beneath(on)
  let agents: AgentInfo[] = [agent('a1', 'running'), agent('a2', 'completed')]
  on('agent.list', async () => ({ value: agents }))
  const frames: string[] = []
  on('ui.blit', async (_$, e) => {
    if ('cells' in e) frames.push(e.cells)
    return { value: {} }
  })
  const colorsNow = () => decode(frames[frames.length - 1]!, 40).colors

  const ui = await $.ui.mount({ ...band(true, 40), surface: 'terminal' })
  await clock.advance(1500)
  expect(colorsNow().has(ORANGE)).toBe(true)
  expect(colorsNow().has(BLUE)).toBe(true) // 動いている a1 だけ。終わった a2 は数えない
  expect(colorsNow().size).toBe(2)

  // 本体の作業が終わっても、サブエージェントが動いている間は本体も仲間も残る
  await ui.redraw(bandProps(false, 40))
  await clock.advance(2000)
  expect(colorsNow().has(ORANGE)).toBe(true)
  expect(colorsNow().has(BLUE)).toBe(true)

  // サブエージェントが終わると、本体も仲間もふわっと消えてから帯ごと消え、止まる
  agents = [agent('a1', 'completed')]
  await clock.advance(1000)
  expect(await ui.find({ key: 'clawd' })).toBeDefined()
  await clock.advance(2000)
  expect(await ui.find({ key: 'clawd' })).toBeUndefined()
  const stopped = frames.length
  await clock.advance(2000)
  expect(frames.length).toBe(stopped)
  await ui.unmount()
})

test('書き換えが続けて通らなくても止まらず、帯を描き直させてから続ける', NO_PLAY, async ($, on) => {
  const clock = mock.clock(on)
  let renders = 0
  on('ui.render', async ($, e) => {
    renders += 1
    const { Box, Text } = $.ui.resolve(e)
    return Box({ key: 'beneath', children: [Text({ children: ['beneath'] })] })
  })
  on('agent.list', async () => ({ value: [] }))
  let denied = 25
  let accepted = 0
  on('ui.blit', async () => {
    if (denied > 0) {
      denied -= 1
      return { value: { deny: 'not mounted' } }
    }
    accepted += 1
    return { value: {} }
  })
  const ui = await $.ui.mount({ ...band(true, 40), surface: 'terminal' })
  const before = renders
  await clock.advance(5000)
  expect(renders).toBeGreaterThan(before) // 通らない状態が続いたので描き直しを頼んだ
  expect(accepted).toBeGreaterThan(10) // 止まらずに書き換えを続けた
  await ui.unmount()
})

test('タイマーが黙って終わっても、次のツール呼び出しで張り直す', NO_PLAY, async ($, on) => {
  let refuse = false
  // mock.clock も clock.every に掛かるので、こちらはアニメーションの 100ms 周期だけに絞る
  on('clock.every', { ms: 100 }, async (_$, e, next) => (refuse ? { deny: 'refused by the test' } : next(e)))
  const clock = mock.clock(on)
  beneath(on)
  on('agent.list', async () => ({ value: [] }))
  on('tool.call', async () => ({ result: 'ok' }) as never)
  const frames: string[] = []
  on('ui.blit', async (_$, e) => {
    if ('cells' in e) frames.push(e.cells)
    return { value: {} }
  })
  const ui = await $.ui.mount({ ...band(true, 40), surface: 'terminal' })
  await clock.advance(1000)
  expect(frames.length).toBeGreaterThan(5)

  // 1 回拒否されるとタイマーは終わり、帯の描き直しが無いので絵は止まる
  refuse = true
  await clock.advance(500)
  refuse = false
  const dead = frames.length
  await clock.advance(3000)
  expect(frames.length).toBe(dead)

  // ツール呼び出しで見張りが気づき、張り直す
  await $.tool.call({ tool: 'Read', file_path: 'a.md' })
  await clock.advance(1000)
  expect(frames.length).toBeGreaterThan(dead + 5)
  await ui.unmount()
})

test('Raster の無い画面では描かない', NO_PLAY, async ($, on) => {
  mock.clock(on)
  beneath(on)
  const ui = await $.ui.mount({ ...band(true), surface: 'desktop' })
  expect(await ui.find({ key: 'clawd' })).toBeUndefined()
  await ui.unmount()
})

// ---- カルガモ行列（.scratch/parade/spec.md） -------------------------------------

/** 本体と、いる仲間（a, b。どちらも x = 0）。本体は右向きにずっと歩く */
const withFriends = (canvas = 400): Crew => advanceBy(sync(hereMain(), ['a', 'b'], () => 0, canvas), FADE_FRAMES, canvas)

/** 行列で k 番目の仲間が本体からさかのぼる距離。誰も道具を持っていないとき（R4・R11） */
const offsets = (crew: Crew): number[] => {
  let offset = 0
  let ahead = MASCOTS[crew[0]!.mascot].width
  return crew.slice(1).map(m => {
    offset += Math.max(ahead, MASCOTS[m.mascot].width) + 2
    ahead = MASCOTS[m.mascot].width
    return offset
  })
}

/** 本体を x に置き、向きを facing にした顔ぶれ */
const placeMain = (crew: Crew, x: number, facing: Wanderer['facing'] = 'right'): Crew => [
  { ...crew[0]!, wanderer: { ...crew[0]!.wanderer, x, facing } },
  ...crew.slice(1),
]

test('R1・R2・S1・契約 lineUp: 条件を満たし乱数が 1/150 未満なら広いほうを向いて始まり、満たさなければ乱数を使わない', () => {
  const crew = withFriends()
  const started = lineUp(crew, seq(0, 0), 400)
  expect(started[0]!.parade!.left).toBe(80)
  expect(started[0]!.parade!.heading).toBe('right') // 本体は x = 74、右のほうが広い
  // 右寄りにいて左を向いていなくても、広い左へ向き直る
  const leftward = lineUp(placeMain(crew, 300, 'right'), seq(0, 0), 400)
  expect([leftward[0]!.parade!.heading, leftward[0]!.wanderer.facing]).toEqual(['left', 'left'])
  expect(lineUp(crew, seq(0, 0.9999), 400)[0]!.parade!.left).toBe(150)
  expect(lineUp(crew, seq(PARADE_CHANCE, 0), 400)[0]!.parade).toBeNull()
  expect(crew[0]!.parade).toBeNull() // 元の顔ぶれは変わらない
  let calls = 0
  const counting = () => {
    calls += 1
    return 0
  }
  lineUp(hereMain(), counting, 400) // 仲間がいない
  lineUp(poke(crew, MAIN, true), counting, 400) // 本体が驚いている
  lineUp(lineUp(crew, seq(0, 0), 400), counting, 400) // すでに行列している
  lineUp(placeMain(crew, 10), counting, 400) // 後ろ（左）に列が収まらない
  expect(calls).toBe(0)
})

test('R9: 本体の後ろにいる仲間は近い順、前にいる仲間はそのあとに並ぶ', () => {
  const crew = withFriends()
  const x = crew[0]!.wanderer.x
  const placed: Crew = [
    crew[0]!,
    { ...crew[1]!, wanderer: { ...crew[1]!.wanderer, x: x + 40 } }, // a は前
    { ...crew[2]!, wanderer: { ...crew[2]!.wanderer, x: x - 30 } }, // b は後ろ
  ]
  expect(lineUp(placed, seq(0, 0), 400).slice(1).map(m => m.id)).toEqual(['b', 'a'])
})

test('R2・契約 begin: 道筋は本体の後ろへまっすぐ延び、帯の中に収まる', () => {
  const right = begin(50, 'right', 100, 80)
  expect(right.trail).toHaveLength(TRAIL)
  expect([right.trail.at(-1), slot(right, 10), slot(right, 60)]).toEqual([50, 40, 0])
  const left = begin(50, 'left', 100, 80)
  expect([slot(left, 10), slot(left, 60)]).toEqual([60, 100])
  expect(left.trail.every(x => x >= 0 && x <= 100)).toBe(true)
})

test('R3・契約 record・slot: 通った位置を 1 ピクセルずつ足し、さかのぼった位置を返す', () => {
  let p = record(begin(50, 'right', 300, 80), 53)
  expect(p.trail.slice(-4)).toEqual([50, 51, 52, 53])
  p = record(p, 51) // 引き返す
  expect(p.trail.slice(-3)).toEqual([53, 52, 51])
  expect(slot(p, 2)).toBe(53)
  expect(p.trail).toHaveLength(TRAIL)
  expect(slot(p, TRAIL + 50)).toBe(p.trail[0])
  expect(record(p, 1000).trail.at(-1)).toBe(1000) // 大きく飛んでも最後は本体の位置
})

test('R3・R4・R5: 本体は 1 コマ 1 ピクセルでまっすぐ進み、仲間は並び順に本体の後ろへ並んで重ならない。仲間は 1 コマ 4 ピクセルまで', () => {
  let crew = lineUp(withFriends(), seq(0, 0), 400)
  for (let i = 0; i < 60; i += 1) {
    const before = crew
    crew = advanceBy(crew, 1, 400)
    expect(crew[0]!.wanderer.x - before[0]!.wanderer.x).toBe(1) // 引き返さず、立ち止まらない
    expect(crew[0]!.wanderer.facing).toBe('right')
    crew.slice(1).forEach((m, k) => expect(Math.abs(m.wanderer.x - before[k + 1]!.wanderer.x)).toBeLessThanOrEqual(4))
  }
  const main = crew[0]!
  const [a, b] = crew.slice(1)
  expect(main.parade).not.toBeNull()
  expect(offsets(crew).map(o => main.wanderer.x - o)).toEqual([a!.wanderer.x, b!.wanderer.x])
  expect(a!.wanderer.x + MASCOTS[a!.mascot].width + 2).toBeLessThanOrEqual(main.wanderer.x)
  expect(b!.wanderer.x + MASCOTS[b!.mascot].width + 2).toBeLessThanOrEqual(a!.wanderer.x)
  expect(actors(crew).slice(1).map(x => x.facing)).toEqual(['right', 'right'])
  // 本体が驚いて止まると、仲間も進まずに直立する
  const still = advanceBy(poke(crew, MAIN, true), 1, 400)
  expect(still[0]!.wanderer.x).toBe(main.wanderer.x)
  expect(still.slice(1).map(m => m.wanderer.x)).toEqual([a!.wanderer.x, b!.wanderer.x])
  expect(actors(still).slice(1).map(x => x.pose)).toEqual(['stand', 'stand'])
})

test('R3・R4: 並び終えたあとは、行列が終わるまで誰も重ならない（折り返さない）', () => {
  let crew = advanceBy(lineUp(withFriends(), seq(0, 0.9999), 400), 30, 400)
  let frames = 0
  while (crew[0]!.parade !== null) {
    const spans = crew.map(m => [m.wanderer.x, m.wanderer.x + MASCOTS[m.mascot].width] as const).sort((p, q) => p[0] - q[0])
    spans.slice(1).forEach((span, i) => expect(span[0]).toBeGreaterThanOrEqual(spans[i]![1]))
    crew = advanceBy(crew, 1, 400)
    frames += 1
  }
  expect(frames).toBeGreaterThan(100)
})

test('R6・S5・S6: 残りが尽きる・端に着く・本体が消え始めると行列をやめ、本体と仲間は立ち止まってから自分で歩く', () => {
  const crew = withFriends()
  const short: Crew = [{ ...crew[0]!, parade: begin(crew[0]!.wanderer.x, 'right', 382, 2) }, ...crew.slice(1)]
  const ended = advanceBy(short, 2, 400)
  expect(ended[0]!.parade).toBeNull()
  expect(ended.map(m => m.wanderer.mode)).toEqual(['pause', 'pause', 'pause'])
  expect(ended[1]!.wanderer.left).toBe(10) // 5〜15 コマ（乱数 0.5）
  // 端（x = 382）に着くとやめる
  const nearEdge = placeMain(crew, 381)
  const edge: Crew = [{ ...nearEdge[0]!, parade: begin(381, 'right', 382, 100) }, ...nearEdge.slice(1)]
  const arrived = advanceBy(edge, 1, 400)
  expect([arrived[0]!.wanderer.x, arrived[0]!.parade !== null]).toEqual([382, true])
  expect(advanceBy(arrived, 1, 400)[0]!.parade).toBeNull()
  // 本体が消え始めると、すぐにやめる
  const leaving = advanceBy(setMain(lineUp(crew, seq(0, 0), 400), false), 1, 400)
  expect(leaving[0]!.parade).toBeNull()
})

test('R7: 驚いている仲間は進まず、驚き終えると追いつく', () => {
  // 並び終えてから驚かせる（行列は 150 コマ）
  let crew = poke(advanceBy(lineUp(withFriends(), seq(0, 0.9999), 400), 60, 400), 'a', true)
  const x = crew[1]!.wanderer.x
  crew = advanceBy(crew, STARTLE_FRAMES - 1, 400)
  expect(crew[1]!.wanderer.x).toBe(x)
  crew = advanceBy(crew, 20, 400)
  expect(crew[0]!.parade).not.toBeNull()
  expect(crew[1]!.wanderer.x).toBe(crew[0]!.wanderer.x - offsets(crew)[0]!)
})

/** 道具の張り出し（絵の端から空ける 1 ピクセル＋道具の幅）。R4 の P */
const REACH = { hammer: 6, magnifier: 7 } as const

/** 1 体だけを描いたピクセル（道具を含む） */
const alone = (actor: Actor, columns: number) => pixels(decode(paint([actor], columns), columns).lines)

/** a の塗りが、b の塗りから r ピクセル以内（斜めを含む）にあるか */
const within = (a: boolean[][], b: boolean[][], r: number) => {
  const around = Array.from({ length: 2 * r + 1 }, (_, i) => i - r)
  return a.some((row, y) => row.some((on, x) => on && around.some(dy => around.some(dx => b[y + dy]?.[x + dx] === true))))
}

test('R4・R11: 道具を持つ仲間の前だけ、道具の張り出しを空けて並び、持っていない仲間の前は今までどおり', () => {
  const crew = advanceBy(lineUp(wield(withFriends(), 'a', 'Edit'), seq(0, 0.9999), 400), 60, 400)
  const [main, a, b] = crew as [Member, Member, Member]
  const width = (m: Member) => MASCOTS[m.mascot].width
  expect(main.wanderer.x - a.wanderer.x).toBe(Math.max(width(main), width(a)) + 2 + REACH.hammer)
  expect(a.wanderer.x - b.wanderer.x).toBe(Math.max(width(a), width(b)) + 2) // R11
  // 虫めがねを持つと、b の前も空く
  const both = advanceBy(wield(crew, 'b', 'Read'), 10, 400)
  expect(both[1]!.wanderer.x - both[2]!.wanderer.x).toBe(Math.max(width(a), width(b)) + 2 + REACH.magnifier)
})

test('R4: 道具を持っていても、並び終えたあとは行列が終わるまで、前の 1 体との間が 2 列以上空いている（右向きも左向きも）', () => {
  const holding = wield(wield(withFriends(), 'a', 'Edit'), 'b', 'Read')
  // 左向き: 本体を右寄り（x = 200）に置き、仲間を本体の後ろ（右）に置く
  const leftward: Crew = [
    placeMain(holding, 200)[0]!,
    ...holding.slice(1).map((m, k) => ({ ...m, wanderer: { ...m.wanderer, x: 230 + 30 * k } })),
  ]
  for (const [start, side] of [[holding, 'right'], [leftward, 'left']] as const) {
    let crew = advanceBy(lineUp(start, seq(0, 0.9999), 400), 30, 400)
    expect(crew[0]!.parade!.heading).toBe(side)
    let frames = 0
    while (crew[0]!.parade !== null) {
      // 並び順（本体・a・b）で、後ろの子の塗り（道具を含む）と前の子の塗りの間が 2 列以上空いている
      const drawn = actors(crew).map(actor => alone(actor, 200))
      drawn.slice(1).forEach((follower, k) =>
        expect({ side, frames, k, near: within(follower, drawn[k]!, 2) }).toEqual({ side, frames, k, near: false }),
      )
      expect(actors(crew).slice(1).map(x => x.prop?.side)).toEqual([side, side])
      crew = advanceBy(crew, 1, 400)
      frames += 1
    }
    expect(frames).toBeGreaterThan(100)
  }
})

test('R10: 行列の途中で道具を持つと、その仲間と後ろの仲間は張り出しの分だけ下がるが、向きは変えない', () => {
  let crew = advanceBy(lineUp(withFriends(), seq(0, 0.9999), 400), 60, 400) // 並び終えている。誰も持っていない
  crew = wield(crew, 'a', 'Read')
  for (let i = 0; i < 6; i += 1) {
    crew = advanceBy(crew, 1, 400)
    expect({ i, facings: actors(crew).slice(1).map(x => x.facing) }).toEqual({ i, facings: ['right', 'right'] })
  }
  const [main, a, b] = crew as [Member, Member, Member]
  const width = (m: Member) => MASCOTS[m.mascot].width
  expect(main.wanderer.x - a.wanderer.x).toBe(Math.max(width(main), width(a)) + 2 + REACH.magnifier)
  expect(a.wanderer.x - b.wanderer.x).toBe(Math.max(width(a), width(b)) + 2)
})

test('R10: 2 体が続けて道具を持ち、張り出し 2 つ分下がるときも振り返らない。本体が止まっていても前を向いて並び直す', () => {
  let crew = advanceBy(lineUp(withFriends(), seq(0, 0.9999), 400), 60, 400) // 並び終えている。誰も持っていない
  crew = poke(crew, MAIN, true) // 本体が驚いて止まる
  crew = wield(wield(crew, 'a', 'Edit'), 'b', 'Read') // b は 6 + 7 = 13 ピクセル下がる
  for (let i = 0; i < 10; i += 1) {
    crew = advanceBy(crew, 1, 400)
    expect({ i, facings: actors(crew).slice(1).map(x => x.facing) }).toEqual({ i, facings: ['right', 'right'] })
  }
  const [main, a, b] = crew as [Member, Member, Member]
  const width = (m: Member) => MASCOTS[m.mascot].width
  expect(main.wanderer.x - a.wanderer.x).toBe(Math.max(width(main), width(a)) + 2 + REACH.hammer)
  expect(a.wanderer.x - b.wanderer.x).toBe(Math.max(width(a), width(b)) + 2 + REACH.magnifier)
})

test('R10・R11: 後ずさりは自分と前の仲間の張り出しの合計まで。道具が無ければ、今までどおり振り返って下がる', () => {
  const lined = advanceBy(lineUp(withFriends(), seq(0, 0.9999), 400), 60, 400) // 並び終えている。誰も持っていない
  /** id の仲間を、いまの位置から dx ピクセル前（右）へずらし、右を向かせる */
  const nudge = (crew: Crew, id: string, dx: number): Crew =>
    crew.map(m => (m.id !== id ? m : { ...m, wanderer: { ...m.wanderer, x: m.wanderer.x + dx, facing: 'right' } }))
  // 道具なし: 目標より 2 ピクセル前にいる a は、振り返って下がる（R11）
  expect(actors(advanceBy(nudge(lined, 'a', 3), 1, 400))[1]!.facing).toBe('left')
  // a がハンマー（6）、b が虫めがね（7）を持って並び直したあと、a が目標より 9 ピクセル前にいる。
  // a の上限は自分の 6 だけ（後ろの b の 7 は足さない）なので、振り返って下がる
  const holding = advanceBy(wield(wield(lined, 'a', 'Edit'), 'b', 'Read'), 10, 400)
  expect(actors(advanceBy(nudge(holding, 'a', 10), 1, 400))[1]!.facing).toBe('left')
})

test('R5・R10: 道具を持っていても、本体より前から回り込むような長い移動では、進む向きを向く', () => {
  const crew = withFriends()
  const x = crew[0]!.wanderer.x
  const placed: Crew = [
    crew[0]!,
    { ...crew[1]!, wanderer: { ...crew[1]!.wanderer, x: x + 40 } }, // a は前
    { ...crew[2]!, wanderer: { ...crew[2]!.wanderer, x: x - 30 } }, // b は後ろ
  ]
  let lined = lineUp(wield(placed, 'a', 'Edit'), seq(0, 0.9999), 400)
  expect(lined.slice(1).map(m => m.id)).toEqual(['b', 'a'])
  lined = advanceBy(lined, 3, 400)
  expect(actors(lined)[2]!.facing).toBe('left') // a は後ろへ回るので、後ろを向いて歩く
})

test('R1: 道具の分を含めて、後ろに列が収まるときだけ始める', () => {
  const crew = withFriends()
  const line = offsets(crew).at(-1)! // 道具を持っていないときの列の長さ
  const fits = placeMain(crew, line + 5) // 右のほうが広いので右へ進み、後ろ（左）に line + 5 ピクセルある
  expect(lineUp(fits, seq(0, 0), 400)[0]!.parade).not.toBeNull()
  let calls = 0
  const counting = () => {
    calls += 1
    return 0
  }
  // a がハンマー（6）を持つと、列が line + 6 になって収まらない
  expect(lineUp(wield(fits, 'a', 'Edit'), counting, 400)[0]!.parade).toBeNull()
  expect(calls).toBe(0)
})

// 行列の途中で止まった仲間（.scratch/parade-rejoin/spec.md）

/** 本体・a（ハンマー）・b（虫めがね）が右へ並び終えた行列 */
const linedWithProps = (): Crew =>
  advanceBy(lineUp(wield(wield(withFriends(), 'a', 'Edit'), 'b', 'Read'), seq(0, 0.9999), 400), 60, 400)

/** frames コマ進め、そのたびに仲間（ids を渡せばその仲間だけ）が右を向いていることを確かめる（振り返らない） */
const facingAhead = (start: Crew, frames: number, ids?: readonly string[]): Crew => {
  let crew = start
  for (let i = 0; i < frames; i += 1) {
    crew = advanceBy(crew, 1, 400)
    const facings = actors(crew)
      .filter((_, k) => k > 0 && (ids === undefined || ids.includes(crew[k]!.id)))
      .map(x => x.facing)
    expect({ i, facings }).toEqual({ i, facings: facings.map(() => 'right') })
  }
  return crew
}

/** 並び終えた位置か（a・b が、道具の分を含めた間隔で本体の後ろにいる） */
const expectSettled = (crew: Crew) => {
  const [main, a, b] = crew as [Member, Member, Member]
  const width = (m: Member) => MASCOTS[m.mascot].width
  expect(main.wanderer.x - a.wanderer.x).toBe(Math.max(width(main), width(a)) + 2 + REACH.hammer)
  expect(a.wanderer.x - b.wanderer.x).toBe(Math.max(width(a), width(b)) + 2 + REACH.magnifier)
}

test('parade-rejoin の R1・R2: 仲間が驚くと後ろの仲間はその場で待ち、驚き終えたら振り返らずに追いつく', () => {
  let crew = poke(linedWithProps(), 'a', true)
  const bx = crew[2]!.wanderer.x
  for (let i = 0; i < STARTLE_FRAMES - 1; i += 1) {
    crew = advanceBy(crew, 1, 400)
    const b = actors(crew)[2]!
    expect({ i, x: b.x, pose: b.pose, facing: b.facing }).toEqual({ i, x: bx, pose: 'stand', facing: 'right' }) // R1
    expect(crew[2]!.wanderer.x).toBeLessThan(crew[1]!.wanderer.x) // 追い越さない
  }
  expectSettled(facingAhead(crew, 30)) // R2
})

test('parade-rejoin の R1: 驚いた仲間より後ろの仲間は、すぐ後ろでなくても全員待つ', () => {
  const three = advanceBy(sync(hereMain(), ['a', 'b', 'c'], () => 0, 400), FADE_FRAMES, 400)
  let crew = poke(advanceBy(lineUp(three, seq(0, 0.9999), 400), 60, 400), 'a', true)
  expect(crew.slice(1).map(m => m.id)).toEqual(['a', 'b', 'c'])
  const behind = crew.slice(2).map(m => m.wanderer.x)
  crew = advanceBy(crew, STARTLE_FRAMES - 1, 400)
  expect(crew.slice(2).map(m => m.wanderer.x)).toEqual(behind)
})

/** 本体と、いる仲間 a・b・c（どれも x = 0）。本体は右向きにずっと歩く */
const threeFriends = (): Crew => advanceBy(sync(hereMain(), ['a', 'b', 'c'], () => 0, 400), FADE_FRAMES, 400)

test('parade-rejoin の R4: 並び順で後ろの仲間が止まっても、前の仲間は進み続ける', () => {
  let crew = poke(advanceBy(lineUp(threeFriends(), seq(0, 0.9999), 400), 60, 400), 'c', true)
  const before = crew.slice(1, 3).map(m => m.wanderer.x)
  crew = advanceBy(crew, 10, 400)
  expect(crew.slice(1, 3).map((m, k) => m.wanderer.x - before[k]!)).toEqual([10, 10]) // 本体と同じく 1 コマ 1 ピクセル
})

test('parade-rejoin の R5: 待っている間に道具を持つと、向きを変えずに下がり、後ろの仲間も続いて下がる', () => {
  const lined = advanceBy(lineUp(threeFriends(), seq(0, 0.9999), 400), 60, 400) // 誰も道具を持っていない
  let crew: Crew = lined.map(m => (m.id === 'a' ? { ...m, idle: DOZE_FRAMES } : m)) // a が居眠りする
  crew = advanceBy(wield(crew, 'c', 'Read'), 5, 400) // 待っている c が虫めがねを持つ
  crew = wield(crew, 'b', 'Edit') // 待っている b がハンマーを持つ
  for (let i = 0; i < 5; i += 1) {
    crew = advanceBy(crew, 1, 400)
    // b が下がるコマのうちに c も続いて下がり、c と b の間はどのコマでも 2 列以上空いている
    const drawn = actors(crew).map(actor => alone(actor, 200))
    const facings = actors(crew).slice(2).map(x => x.facing)
    expect({ i, facings, near: within(drawn[3]!, drawn[2]!, 2) }).toEqual({ i, facings: ['right', 'right'], near: false })
  }
  expect(actors(crew)[1]!.pose).toBe('sleep')
  const [, a, b, c] = crew as [Member, Member, Member, Member]
  const width = (m: Member) => MASCOTS[m.mascot].width
  expect(a.wanderer.x - b.wanderer.x).toBe(Math.max(width(a), width(b)) + 2 + REACH.hammer)
  expect(b.wanderer.x - c.wanderer.x).toBe(Math.max(width(b), width(c)) + 2 + REACH.magnifier)
  // 描いた絵でも、すぐ前の仲間との間が 2 列以上空いている
  const drawn = actors(crew).map(actor => alone(actor, 200))
  expect([within(drawn[2]!, drawn[1]!, 2), within(drawn[3]!, drawn[2]!, 2)]).toEqual([false, false])
  // R1: 待っている間に道具をしまっても、前へは詰めない
  const stowed = advanceBy(crew.map(m => (m.id === 'b' ? { ...m, prop: null } : m)), 5, 400)
  expect(stowed.slice(2).map(m => m.wanderer.x)).toEqual(crew.slice(2).map(m => m.wanderer.x))
})

test('parade-rejoin の R6: 行列を始めるとき、歩けない仲間は並び順の最後に回り、ほかの仲間は待たずに並ぶ', () => {
  const crew = withFriends()
  const x = crew[0]!.wanderer.x
  const placed: Crew = [
    crew[0]!,
    { ...crew[1]!, idle: DOZE_FRAMES, wanderer: { ...crew[1]!.wanderer, x: x - 25 } }, // a は本体のすぐ後ろで居眠り
    { ...crew[2]!, wanderer: { ...crew[2]!.wanderer, x: x - 60 } }, // b はその後ろ
  ]
  let lined = lineUp(placed, seq(0, 0.9999), 400)
  expect(lined.slice(1).map(m => m.id)).toEqual(['b', 'a'])
  const bx = lined[1]!.wanderer.x
  lined = advanceBy(lined, 5, 400)
  expect(lined[1]!.wanderer.x).toBeGreaterThan(bx) // b は待たずに本体を追う
})

test('parade-rejoin の R1・R2: 消えかけから戻る仲間の後ろでは待ち、戻ったら振り返らずに追いつく', () => {
  const lined = linedWithProps()
  let crew = advanceBy(sync(lined, ['b'], () => 0, 400), LEAP_FRAMES + 3, 400) // a が消えかける
  expect(crew[1]!.presence.kind).toBe('leaving')
  const bx = crew[2]!.wanderer.x
  crew = advanceBy(sync(crew, ['a', 'b'], () => 0, 400), 1, 400) // a が戻ってくる（現れかけ）
  expect(crew[1]!.presence.kind).toBe('arriving')
  expect(crew[2]!.wanderer.x).toBe(bx) // R1
  expectSettled(facingAhead(crew, 40, ['b'])) // R2
})

test('parade-rejoin の R1・R5: 回り込みの途中で前の仲間が止まると、進む向きを向いて後ろへ回り、立ち止まったら行列の向きを向く', () => {
  const crew = threeFriends()
  const placed: Crew = [
    placeMain(crew, 100)[0]!,
    { ...crew[1]!, wanderer: { ...crew[1]!.wanderer, x: 75 } }, // a は本体の後ろ
    { ...crew[2]!, wanderer: { ...crew[2]!.wanderer, x: 170 } }, // b・c は本体の前
    { ...crew[3]!, wanderer: { ...crew[3]!.wanderer, x: 200 } },
  ]
  let lined = advanceBy(lineUp(wield(placed, 'b', 'Edit'), seq(0, 0.9999), 400), 4, 400)
  expect(lined.slice(1).map(m => m.id)).toEqual(['a', 'b', 'c'])
  // 回り込みの途中で a が居眠りする。b・c はそのとき行列の向き（右）を向いていたとする
  lined = lined.map(m =>
    m.id === 'a' ? { ...m, idle: DOZE_FRAMES } : m.id === MAIN ? m : { ...m, wanderer: { ...m.wanderer, facing: 'right' as const } },
  )
  lined = advanceBy(lined, 1, 400)
  expect(actors(lined).slice(2).map(x => x.facing)).toEqual(['left', 'left']) // a より前にいるので、進む向き（左）を向いて下がる
  lined = advanceBy(lined, 80, 400)
  const [, a, b, c] = lined as [Member, Member, Member, Member]
  expect(b.wanderer.x).toBeLessThan(a.wanderer.x)
  expect(c.wanderer.x).toBeLessThan(b.wanderer.x)
  expect(actors(lined).slice(2).map(x => x.facing)).toEqual(['right', 'right']) // 立ち止まったら行列の向き
  const drawn = actors(lined).map(actor => alone(actor, 200))
  expect([within(drawn[2]!, drawn[1]!, 2), within(drawn[3]!, drawn[2]!, 2)]).toEqual([false, false])
})

/** 本体・a（ハンマー）・b（虫めがね）が左へ並び終えた行列 */
const linedLeftWithProps = (): Crew => {
  const holding = wield(wield(withFriends(), 'a', 'Edit'), 'b', 'Read')
  const leftward: Crew = [
    placeMain(holding, 200)[0]!,
    ...holding.slice(1).map((m, k) => ({ ...m, wanderer: { ...m.wanderer, x: 230 + 30 * k } })),
  ]
  return advanceBy(lineUp(leftward, seq(0, 0.9999), 400), 30, 400)
}

test('parade-rejoin の R7: 左へ進む行列で、待っている仲間はすぐ前の仲間の zZ・「!」から 2 列以上離れる', () => {
  const dozing = linedLeftWithProps().map(m => (m.id === 'a' ? { ...m, idle: DOZE_FRAMES } : m))
  const startled = poke(linedLeftWithProps(), 'a', true)
  for (const [kind, start] of [['doze', dozing], ['startle', startled]] as const) {
    expect(start[0]!.parade!.heading).toBe('left')
    let crew = advanceBy(start, 2, 400) // 記号を出し始めてから下がりきるまでの 2 コマを除く
    for (let i = 0; i < 15; i += 1) {
      // alone は文字のマス（zZ）を、4 つとも塗ったピクセルとして読む
      const drawn = actors(crew).map(actor => alone(actor, 200))
      expect({ kind, i, near: within(drawn[2]!, drawn[1]!, 2) }).toEqual({ kind, i, near: false })
      crew = advanceBy(crew, 1, 400)
    }
  }
})

test('parade-rejoin の R8: 行列の間に来た仲間は、最後尾で止まっている仲間より前に並び、待たずについていく', () => {
  let crew = advanceBy(lineUp(threeFriends(), seq(0, 0.9999), 400), 40, 400)
  crew = crew.map(m => (m.id === 'c' ? { ...m, idle: DOZE_FRAMES } : m)) // 最後尾の c が居眠りする
  crew = join(crew, 'd', () => 0.5, 400)
  expect(crew.slice(1).map(m => m.id)).toEqual(['a', 'b', 'd', 'c'])
  crew = advanceBy(crew, 70, 400)
  const [, , b, d] = crew as [Member, Member, Member, Member]
  expect(b.wanderer.x - d.wanderer.x).toBe(Math.max(MASCOTS[b.mascot].width, MASCOTS[d.mascot].width) + 2)
  expect(actors(crew)[3]!.facing).toBe('right')
})

test('parade-rejoin の R1・R2: 居眠りしている仲間の後ろでは待ち、起きたら振り返らずに追いつく', () => {
  let crew: Crew = linedWithProps().map(m => (m.id === 'a' ? { ...m, idle: DOZE_FRAMES } : m))
  const bx = crew[2]!.wanderer.x
  crew = advanceBy(crew, 20, 400)
  expect(actors(crew)[1]!.pose).toBe('sleep')
  expect(crew[2]!.wanderer.x).toBe(bx) // R1
  crew = wield(poke(crew, 'a', false), 'a', 'Edit') // ツールの呼び出しで起きる
  expectSettled(facingAhead(crew, 30)) // R2
})

test('parade-rejoin の R1・R2: 消えていく仲間の後ろでは待ち、消えきったら振り返らずに前へ詰める', () => {
  let crew = sync(advanceBy(lineUp(withFriends(), seq(0, 0.9999), 400), 60, 400), ['b'], () => 0, 400) // a が終わる
  const bx = crew[2]!.wanderer.x
  crew = advanceBy(crew, LEAP_FRAMES + FADE_FRAMES - 1, 400)
  expect(crew.map(m => [m.id, m.presence.kind])).toEqual([[MAIN, 'here'], ['a', 'leaving'], ['b', 'here']])
  expect(crew[2]!.wanderer.x).toBe(bx) // R1
  crew = facingAhead(crew, 30)
  expect(crew.map(m => m.id)).toEqual([MAIN, 'b'])
  expect(crew[0]!.wanderer.x - crew[1]!.wanderer.x).toBe(Math.max(MASCOTS.clawd.width, MASCOTS[crew[1]!.mascot].width) + 2) // R2
})

// ---- 重なり（.scratch/overlap/spec.md） ---------------------------------------

/** 帯の幅 width ピクセルに、actor の絵を置いたビットマップ */
const placed = (actor: Actor, width: number): boolean[][] => {
  const bitmap = MASCOTS[actor.mascot].draw(actor.facing, actor.pose)
  return Array.from({ length: MASCOT_HEIGHT }, (_, y) => Array.from({ length: width }, (_, x) => bitmap[y]![x - actor.x] ?? false))
}

/** front の塗りから 1 ピクセル以内（斜めを含む）か */
const near = (front: boolean[][], x: number, y: number) =>
  [-1, 0, 1].some(dy => [-1, 0, 1].some(dx => front[y + dy]?.[x + dx] === true))

/** back の上に front を描いたときに期待する絵: front の塗りと、front から 2 ピクセル以上離れた back の塗り */
const knockedOut = (back: boolean[][], front: boolean[][]) =>
  back.map((row, y) => row.map((on, x) => front[y]![x]! || (on && !near(front, x, y))))

test('R1・R2: 仲間が本体に重なると、仲間の塗りから 1 ドット以内の本体のドットが消え、それ以外は残る。後に描いた者が手前', () => {
  const back = clawd(0)
  const front = clawd(12, { mascot: 'ghost', color: BLUE })
  const b = placed(back, 32)
  const f = placed(front, 32)
  expect(pixels(decode(paint([back, front], 16), 16).lines)).toEqual(knockedOut(b, f))
  // 描く順を入れ替えると、消える側も入れ替わる
  expect(pixels(decode(paint([front, back], 16), 16).lines)).toEqual(knockedOut(f, b))
})

test('R3: 手前が薄くなっている途中なら、奥のドットは消えない', () => {
  const back = clawd(0)
  const drawn = pixels(decode(paint([back, clawd(12, { mascot: 'ghost', color: BLUE, opacity: 0.5 })], 16), 16).lines)
  placed(back, 32).forEach((row, y) => row.forEach((on, x) => on && expect({ x, y, lit: drawn[y]![x] }).toEqual({ x, y, lit: true })))
})

test('R4: 濃さ 1 の 2 体が重なっても、どのマスにも 2 体のドットが入らない（どの位置でも）', () => {
  for (let x = 2; x <= 20; x += 1) {
    const front = clawd(x, { mascot: 'ghost', color: BLUE })
    const drawn = pixels(decode(paint([clawd(0), front], 16), 16).lines)
    const f = placed(front, 32)
    for (let cy = 0; cy < MASCOT_HEIGHT; cy += 2) {
      for (let cx = 0; cx < 32; cx += 2) {
        const cell = [[cy, cx], [cy, cx + 1], [cy + 1, cx], [cy + 1, cx + 1]] as const
        const hasFront = cell.some(([y, px]) => f[y]![px])
        const hasBack = cell.some(([y, px]) => drawn[y]![px] && !f[y]![px])
        expect({ x, cx, cy, mixed: hasFront && hasBack }).toEqual({ x, cx, cy, mixed: false })
      }
    }
  }
})

// ---- 持ち替えてから 1.5 秒は見せ続ける（.scratch/props/spec.md の R23） --------------------

const MAGNIFIER_RIM = 0xc0c6cc

test('R23・S13〜S18・契約 grab・relax・decay: 持ち替えてから 15 コマは今の道具を見せ、たったら最後に求めた道具に持ち替える', () => {
  expect(SWAP_FRAMES).toBe(15)
  const decayBy = (grip: ReturnType<typeof grab> | null, frames: number) => {
    let next = grip
    for (let i = 0; i < frames; i += 1) next = decay(next)
    return next
  }
  // S14・S18: 虫めがねに持ち替えた直後にフラスコを求めると、15 コマたつまで虫めがねのまま
  const waiting = grab(grab(null, 'magnifier'), 'flask')
  expect(waiting).toMatchObject({ kind: 'magnifier', next: 'flask', using: 2 })
  expect(decayBy(waiting, SWAP_FRAMES - 1)).toMatchObject({ kind: 'magnifier', held: SWAP_FRAMES - 1, next: 'flask' })
  expect(decayBy(waiting, SWAP_FRAMES)).toMatchObject({ kind: 'flask', held: 0, next: null })
  // S14: 待っている間に別の道具を求めると、待つ道具を替える（最後に求めた道具）
  expect(relax(waiting, 'hammer')).toMatchObject({ kind: 'magnifier', next: 'hammer', using: 1 })
  // S17: 今と同じ道具を求めると、待ちを取りやめる
  expect(grab(waiting, 'magnifier')).toMatchObject({ kind: 'magnifier', next: null })
  // S13・S15: 同じ道具なら経過はそのまま、1 コマごとに 1 進み、15 で止まる
  expect(grab(decayBy(grab(null, 'hammer'), 4), 'hammer').held).toBe(4)
  expect(decayBy(grab(null, 'hammer'), 40)!.held).toBe(SWAP_FRAMES)
  // S16: 15 コマたっていれば、すぐ持ち替える
  expect(grab(decayBy(grab(null, 'hammer'), SWAP_FRAMES), 'pencil')).toMatchObject({ kind: 'pencil', held: 0, next: null })
  // 持ち替える前に余韻が尽きれば、持ち替えずにしまう
  const short = relax(relax(grab(null, 'magnifier'), 'magnifier', 3), 'flask', 3)
  expect(short).toMatchObject({ kind: 'magnifier', next: 'flask', using: 0, left: 3 })
  expect(decayBy(short, 3)).toBeNull()
})

test('register・R23: Read のすぐあとにテストの Bash が始まっても、虫めがねを見せてからフラスコに持ち替える', NO_PLAY, async ($, on) => {
  const clock = mock.clock(on)
  beneath(on)
  on('agent.list', async () => ({ value: [] }))
  let finish: (result: unknown) => void = () => undefined
  on('tool.call', async (_$, e) =>
    (e as { tool: string }).tool === 'Bash' ? (new Promise(resolve => (finish = resolve)) as never) : ({ result: 'ok' } as never),
  )
  const frames: string[] = []
  on('ui.blit', async (_$, e) => {
    if ('cells' in e) frames.push(e.cells)
    return { value: {} }
  })
  const ui = await $.ui.mount({ ...band(true, 60), surface: 'terminal' })
  await clock.advance(1500) // 現れきる
  await $.tool.call({ tool: 'Read', file_path: 'a.md' } as never)
  const test = $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  const start = frames.length
  await clock.advance(1200)
  const early = frames.slice(start)
  expect(early.some(cells => cellColors(cells).has(MAGNIFIER_RIM))).toBe(true) // 1.2 秒は虫めがねのまま
  expect(early.some(cells => cellColors(cells).has(FLASK_GLASS))).toBe(false)
  await clock.advance(800)
  expect(cellColors(frames[frames.length - 1]!).has(FLASK_GLASS)).toBe(true) // 2 秒でフラスコ
  finish({ result: 'ok' })
  await test
  await ui.unmount()
})

// ---- /config で時間を変える（.scratch/config/spec.md） ---------------------------------

test('config R3・契約 timingOf: 1〜3600 秒の数だけをコマ数にし、それ以外は既定値にする', () => {
  expect(timingOf({})).toEqual(DEFAULT_TIMING)
  expect(DEFAULT_TIMING).toEqual({ dozeFrames: DOZE_FRAMES, propFrames: PROP_FRAMES })
  expect(timingOf({ doze_seconds: 30, prop_seconds: 2.5 })).toEqual({ dozeFrames: 300, propFrames: 25 })
  expect(timingOf({ doze_seconds: 1, prop_seconds: 3600 })).toEqual({ dozeFrames: 10, propFrames: 36000 })
  for (const bad of [0, 0.5, 3601, -5, Number.NaN, '30', true, ['30']]) {
    expect(timingOf({ doze_seconds: bad, prop_seconds: bad })).toEqual(DEFAULT_TIMING)
  }
  const options = { doze_seconds: 30 }
  timingOf(options)
  expect(options).toEqual({ doze_seconds: 30 }) // 引数を変更しない
})

test('config R1: 居眠りまでのコマ数を timing で渡すと、そのコマ数で居眠りする', () => {
  const timing = { ...DEFAULT_TIMING, dozeFrames: 50 }
  let crew = hereMain()
  for (let i = 0; i < 49; i += 1) crew = advance(crew, 200, () => 0.5, timing)
  expect(actors(crew, timing)[0]!.pose).not.toBe('sleep')
  crew = advance(crew, 200, () => 0.5, timing)
  expect(actors(crew, timing)[0]).toMatchObject({ pose: 'sleep', emote: { kind: 'doze' } })
  expect(actors(crew)[0]!.pose).not.toBe('sleep') // 既定（60 秒）ならまだ起きている（R4）
})

test('config R1・register: doze_seconds = 2 なら、ツールを使わずに 2 秒たつと居眠りの zZ を描く', { options: { play: false, doze_seconds: 2 } }, async ($, on) => {
  const clock = mock.clock(on)
  beneath(on)
  on('agent.list', async () => ({ value: [] }))
  const frames: string[] = []
  on('ui.blit', async (_$, e) => {
    if ('cells' in e) frames.push(e.cells)
    return { value: {} }
  })
  const ui = await $.ui.mount({ ...band(true, 40), surface: 'terminal' })
  await clock.advance(1500) // 現れきる
  const asleep = () => decode(frames[frames.length - 1]!, 40).lines.join('').includes('z')
  expect(asleep()).toBe(false)
  await clock.advance(2500)
  expect(asleep()).toBe(true)
  await ui.unmount()
})

test('config R2・register: prop_seconds = 3 なら、道具を使い終えてから 3 秒でしまう', { options: { play: false, prop_seconds: 3 } }, async ($, on) => {
  const clock = mock.clock(on)
  beneath(on)
  on('agent.list', async () => ({ value: [] }))
  on('tool.call', async () => ({ result: 'ok' }) as never)
  const frames: string[] = []
  on('ui.blit', async (_$, e) => {
    if ('cells' in e) frames.push(e.cells)
    return { value: {} }
  })
  const ui = await $.ui.mount({ ...band(true, 60), surface: 'terminal' })
  await clock.advance(1500) // 現れきる
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  await clock.advance(2000)
  expect(frames.slice(-20).some(cells => cellColors(cells).has(FLASK_GLASS))).toBe(true) // 使い終えてから 0〜2 秒
  await clock.advance(2000)
  expect(frames.slice(-10).some(cells => cellColors(cells).has(FLASK_GLASS))).toBe(false) // 3〜4 秒
  await ui.unmount()
})

// ---- 呼び出しが動いている間は眠らない（.scratch/emotes/spec.md の R11〜R13） ----------------

test('emotes R11〜R13・engage・disengage: 呼び出しが動いている間は眠らず、終わってから数え始める', () => {
  const busy = engage(hereMain(), MAIN)
  expect(busy[0]!.busy).toBe(1)
  const long = advanceBy(busy, DOZE_FRAMES * 2, 200)
  expect(long[0]!.idle).toBe(0) // R11: 途切れを数えない
  expect(actors(long)[0]!.pose).not.toBe('sleep')
  const done = disengage(long, MAIN)
  expect(done[0]!.busy).toBe(0)
  expect(actors(advanceBy(done, DOZE_FRAMES - 1, 200))[0]!.pose).not.toBe('sleep')
  expect(actors(advanceBy(done, DOZE_FRAMES, 200))[0]).toMatchObject({ pose: 'sleep', emote: { kind: 'doze' } })
  expect(disengage(done, MAIN)[0]!.busy).toBe(0) // R12: 0 より下げない
  expect(engage(busy, 'nobody')).toEqual(busy) // いない id では数えない
  expect(engage(assemble(), MAIN)[0]!.busy).toBe(0) // 消えきっている 1 体では数えない
  const gone = advanceBy(setMain(engage(busy, MAIN), false), LEAP_FRAMES + FADE_FRAMES + 1, 200)
  expect(gone[0]!.presence.kind).toBe('gone')
  expect(gone[0]!.busy).toBe(0) // R13: 消えきると 0
  const snapshot = JSON.stringify(busy)
  engage(busy, MAIN)
  disengage(busy, MAIN)
  expect(JSON.stringify(busy)).toBe(snapshot) // crew を変更しない
})

test('emotes R11・register: 居眠りの秒数を超えてテストが走っても眠らず、フラスコを持ち続け、終わってから眠る', { options: { play: false, doze_seconds: 2 } }, async ($, on) => {
  const clock = mock.clock(on)
  beneath(on)
  on('agent.list', async () => ({ value: [] }))
  let finish: (result: unknown) => void = () => undefined
  on('tool.call', () => new Promise(resolve => (finish = resolve)) as never)
  const frames: string[] = []
  on('ui.blit', async (_$, e) => {
    if ('cells' in e) frames.push(e.cells)
    return { value: {} }
  })
  const ui = await $.ui.mount({ ...band(true, 60), surface: 'terminal' })
  await clock.advance(1500) // 現れきる
  const asleep = () => decode(frames[frames.length - 1]!, 60).lines.join('').includes('z')
  const call = $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  await clock.advance(6000) // 居眠りの 2 秒の 3 倍
  expect(asleep()).toBe(false)
  expect(frames.slice(-50).some(cells => cellColors(cells).has(FLASK_GLASS))).toBe(true)
  finish({ result: 'ok' })
  await call
  await clock.advance(1500)
  expect(asleep()).toBe(false) // 終わってから 1.5 秒はまだ起きている
  await clock.advance(1000)
  expect(asleep()).toBe(true) // 2.5 秒で眠る
  await ui.unmount()
})

// ---- 道具を見せている者は手前に描く（.scratch/overlap/spec.md の R6） ----------------------

test('overlap R6: 道具を見せている者は、渡した順に関わらず、見せていない者より手前に描く', () => {
  const ghost = (x: number): Actor => ({ mascot: 'ghost', x, facing: 'front', pose: 'stand', color: BLUE })
  const holder = clawd(10, { facing: 'left', prop: { kind: 'hourglass', side: 'left', raised: false } })
  const plain = clawd(10, { facing: 'left' })
  // 重なっている（道具が無ければ、渡す順で見え方が変わる）
  expect(paint([plain, ghost(14)], 20)).not.toBe(paint([ghost(14), plain], 20))
  // 道具を見せている本体は、先に渡しても後に渡しても手前
  expect(paint([holder, ghost(14)], 20)).toBe(paint([ghost(14), holder], 20))
  // 道具を見せていない者どうしは、渡した順のまま（R2）
  expect(paint([ghost(4), ghost(8)], 20)).not.toBe(paint([ghost(8), ghost(4)], 20))
})

// ---- 波乗り（.scratch/surf/spec.md） -----------------------------------------------

const BOARD = 0xf2c94c
const WATER = 0x4a90d9
const FOAM = 0xe8f4ff

/** ひとりの本体（x の位置。帯の幅 200 ピクセルなら置ける x の最大は 182） */
const soloMain = (x = 50): Crew => hereMain(x).map(m => ({ ...m, wanderer: { ...m.wanderer, x } }))

/** 返す値と、呼ばれた回数を数える乱数 */
const counted = (value: number) => {
  let calls = 0
  return { random: () => ((calls += 1), value), calls: () => calls }
}

/** 波に乗っている本体（x の位置から heading へ） */
const surfing = (x = 50): Crew => beginPlay(soloMain(x), 'surf', 200)

test('play R1・R2・T2〜T7・契約 startPlay・playable: 条件がそろえば始め、始められる遊びから乱数で選ぶ。T2〜T5 では乱数を使わない', () => {
  expect([PLAY_CHANCE, MIN_RIDE, MIN_CHASE, SURF_PACE, EBB_FRAMES]).toEqual([1 / 600, 30, 60, 3, 6])
  expect(playable(50, 182)).toEqual(['surf', 'dance', 'butterfly'])
  expect(playable(20, 42)).toEqual(['dance']) // 広いほうの奥行き 22 では波乗りも蝶々もできない
  expect(playable(10, 50)).toEqual(['surf', 'dance']) // 奥行き 40
  // T7: 1 回目の乱数で始めるかを、2 回目でどれにするかを決める
  const crew = soloMain(50)
  const snapshot = JSON.stringify(crew)
  for (const [pick, kind] of [[0, 'surf'], [0.5, 'dance'], [0.99, 'butterfly']] as const) {
    const values = [0, pick]
    let calls = 0
    const started = startPlay(crew, () => values[calls++]!, 200)
    expect(started[0]!.play?.kind).toBe(kind)
    expect(calls).toBe(2)
  }
  expect(JSON.stringify(crew)).toBe(snapshot) // crew を変更しない
  // 波乗り・蝶々は広いほうを向く。小踊りはその場で止まる
  expect(beginPlay(soloMain(50), 'surf', 200)[0]!).toMatchObject({ play: { kind: 'surf', heading: 'right', ebb: null }, wanderer: { facing: 'right' } })
  expect(beginPlay(soloMain(150), 'butterfly', 200)[0]!.play).toMatchObject({ kind: 'butterfly', heading: 'left' })
  expect(beginPlay(soloMain(50), 'dance', 200)[0]!).toMatchObject({ play: { kind: 'dance', left: DANCE_FRAMES }, wanderer: { mode: 'pause' } })
  // T6: 乱数が外れると始めない（乱数は 1 回）
  const miss = counted(PLAY_CHANCE)
  expect(startPlay(crew, miss.random, 200)).toBe(crew)
  expect(miss.calls()).toBe(1)
  // T2〜T4: 始めず、乱数も使わない
  const none = counted(0)
  const notAlone = sync(soloMain(), ['a'], () => 0, 200)
  const startled = poke(soloMain(), MAIN, true)
  const busy = surfing()
  for (const c of [notAlone, startled, busy]) expect(startPlay(c, none.random, 200)).toBe(c)
  expect(none.calls()).toBe(0)
})

test('surf R2〜R5・S4・S5・S8: 1 コマ 3 ピクセル滑り、端の手前で止まって 6 コマ引き、降りて立ち止まる', () => {
  const one = advance(surfing(50), 200, () => 0.5)
  expect(one[0]!.wanderer).toMatchObject({ x: 50 + SURF_PACE, facing: 'right' }) // S4
  expect(one[0]!.play).toEqual({ kind: 'surf', heading: 'right', ebb: null })
  // S5: 次で端（置ける x の最大 182）を越えるなら、その場で止まって引き始める
  const nearEdge = surfing(50).map(m => ({ ...m, wanderer: { ...m.wanderer, x: 181 } }))
  const edge = advance(nearEdge, 200, () => 0.5)
  expect(edge[0]!.wanderer.x).toBe(181)
  expect(edge[0]!.play).toMatchObject({ kind: 'surf', ebb: EBB_FRAMES })
  // S8: 引いている間は動かず、6 コマで引ききって降りる
  const receding = advanceBy(edge, EBB_FRAMES - 1, 200)
  expect(receding[0]!.play).toMatchObject({ kind: 'surf', ebb: 1 })
  expect(receding[0]!.wanderer.x).toBe(181)
  const landed = advanceBy(edge, EBB_FRAMES, 200)
  expect(landed[0]!.play).toBeNull()
  expect(landed[0]!.wanderer.mode).toBe('pause') // R5: 立ち止まってから歩き出す
})

test('surf R6・R7・R11・S6・S7: 仲間が来ると引き、驚く・居眠り・引っ込められるとやめ、波乗りの間は行列を始めない', () => {
  // S6: 仲間が加わると、その場で止まって引く
  const crowded = advance(sync(surfing(50), ['a'], () => 0, 200), 200, () => 0.5)
  expect(crowded[0]!.play).toMatchObject({ kind: 'surf', ebb: EBB_FRAMES })
  expect(crowded[0]!.wanderer.x).toBe(50)
  // S7: 驚く・居眠りする・引っ込められると、その場でやめる
  expect(advance(poke(surfing(), MAIN, true), 200, () => 0.5)[0]!.play).toBeNull()
  const sleepy = surfing().map(m => ({ ...m, idle: DOZE_FRAMES }))
  expect(advance(sleepy, 200, () => 0.5)[0]!.play).toBeNull()
  expect(advance(setMain(surfing(), false), 200, () => 0.5)[0]!.play).toBeNull()
  // R11: 波乗り（引いている間）は行列を始めない
  const withFriend = advanceBy(sync(surfing(50), ['a'], () => 0, 200), 1, 200)
  const here = withFriend.map(m => (m.id === 'a' ? { ...m, presence: HERE } : m))
  expect(lineUp(here, () => 0, 200)[0]!.parade).toBeNull()
})

test('surf R8・R9・契約 Actor.surf: 波乗りの間は板に乗って向かう側を向き、道具を描かず、引く間は薄くなる', () => {
  const held = wield(surfing(), MAIN, 'Edit')
  const actor = actors(held)[0]!
  expect(actor).toMatchObject({ facing: 'right', surf: { heading: 'right', fade: 1 } })
  expect(actor.prop).toBeUndefined() // R8
  expect(held[0]!.prop).not.toBeNull() // 道具は持ったまま（数と残りは変わり続ける）
  const ebbing = advance(sync(surfing(), ['a'], () => 0, 200), 200, () => 0.5)
  expect(actors(ebbing)[0]!.surf?.fade).toBe(1) // 引き始め（残り 6）
  expect(actors(advanceBy(ebbing, 3, 200))[0]!.surf?.fade).toBe(3 / EBB_FRAMES)
})

test('surf R9・R4・契約 surfPixels: 板・水面・波・泡を描き、左へ進むときは反転し、薄くするときは板と板の真下の水面を残す', () => {
  const right = surfPixels('right', 1)
  const of = (pixels: typeof right, color: number) => pixels.filter(p => p.color === color)
  expect(of(right, BOARD).map(p => p.dx)).toEqual(Array.from({ length: 20 }, (_, i) => i - 1)) // 本体の幅 + 2
  expect(of(right, BOARD).every(p => p.y === 4)).toBe(true)
  expect(of(right, FOAM).length).toBe(3)
  // 水面は波の後ろの端（-16）から板の先 + 2（20）まで、切れ目なし
  expect(right.filter(p => p.y === 5).map(p => p.dx)).toEqual(Array.from({ length: 37 }, (_, i) => i - 16))
  // 波は本体の後ろ（右へ進むなら左）
  expect(right.filter(p => p.y < 4).every(p => p.dx < 0)).toBe(true)
  const left = surfPixels('left', 1)
  expect(left.filter(p => p.y < 4).every(p => p.dx > 17)).toBe(true)
  // 薄くすると波と水面が減り、板と板の真下の水面（-1〜18）は残る
  const faded = surfPixels('right', 0.5)
  expect(of(faded, BOARD).length).toBe(20)
  expect(faded.length).toBeLessThan(right.length)
  const gone = surfPixels('right', 0)
  expect(gone.filter(p => p.color !== BOARD).every(p => p.y === 5 && p.dx >= -1 && p.dx <= 18)).toBe(true)
  expect(gone.filter(p => p.y === 5).length).toBe(20)
})

test('surf R9・paint: 波乗りの本体は 1 ピクセル浮いて脚を描かず、板・水面・波の色で描く', () => {
  const columns = 30
  const riding = clawd(30, { facing: 'right', surf: { heading: 'right', fade: 1 } })
  const cells = paint([riding], columns)
  const colors = cellColors(cells)
  for (const color of [ORANGE, BOARD, WATER, FOAM]) expect(colors.has(color)).toBe(true)
  // 最下段のマス（ピクセルの 4・5 行目）には、本体の橙が無い（脚の代わりに板）
  const words = new Uint32Array(Uint8Array.from(atob(cells), c => c.charCodeAt(0)).buffer)
  for (let col = 0; col < columns; col += 1) {
    const at = ((SPRITE_ROWS - 1) * columns + col) * 3
    if (words[at] === 0x20) continue
    expect([words[at + 1], words[at + 2]]).not.toContain(ORANGE)
  }
  // 浮かせても頭は切れない（Clawd の最上行は空き）
  expect(litCount(decode(cells, columns).lines)).toBeGreaterThan(litCount(decode(paint([clawd(30)], columns), columns).lines))
})

test('surf R4・R9・paint: 板の下のマスは、乗っている間も引いている間も板の黄と水の青の 2 色で描く（黄色い歯にならない）', () => {
  const columns = 30
  for (const fade of [1, 0.5, 1 / 6]) {
    // x = 30（偶数）なら板（-1〜18 → 29〜48）は 1 マス目の途中から始まるので、板の全幅を含むマス（15〜23 列）を見る
    const cells = paint([clawd(30, { facing: 'right', surf: { heading: 'right', fade } })], columns)
    const words = new Uint32Array(Uint8Array.from(atob(cells), c => c.charCodeAt(0)).buffer)
    for (let col = 15; col <= 23; col += 1) {
      const at = ((SPRITE_ROWS - 1) * columns + col) * 3
      expect({ col, fade, colors: [words[at + 1], words[at + 2]].sort() }).toEqual({ col, fade, colors: [BOARD, WATER].sort() })
    }
  }
})

test('surf R9・paint: 泡は、マスとの位置がどちらにずれても描かれる', () => {
  for (const x of [30, 31]) {
    const cells = paint([clawd(x, { facing: 'right', surf: { heading: 'right', fade: 1 } })], 30)
    expect({ x, foam: cellColors(cells).has(FOAM) }).toEqual({ x, foam: true })
  }
})

/**
 * ひとりの本体を `minutes` 分歩かせ、帯に黄色（波乗りの板と蝶々の色）が出たか（ひとり遊びをしたか）。
 * 小踊りだけでは黄色が出ないが、10 分の遊びがすべて小踊りになる確率は無視できる。
 * 居眠りしないよう、設定の居眠りまでの秒数を 3600 にして呼ぶ
 * （終わらないツール呼び出しで起こしておく形は、呼び出しのフックが時間切れで外されるので使えない）
 */
async function playsWithin($: Parameters<Parameters<typeof test>[1]>[0], on: On, minutes: number): Promise<boolean> {
  const clock = mock.clock(on)
  beneath(on)
  on('agent.list', async () => ({ value: [] }))
  let played = false
  on('ui.blit', async (_$, e) => {
    if ('cells' in e && cellColors(e.cells).has(BOARD)) played = true
    return { value: {} }
  })
  const ui = await $.ui.mount({ ...band(true, 100), surface: 'terminal' })
  await clock.advance(minutes * 60_000)
  await ui.unmount()
  return played
}

test('play R5・T1・register: play が false なら、10 分ひとりで歩いてもひとり遊びをしない', { options: { play: false, doze_seconds: 3600 } }, async ($, on) => {
  expect(await playsWithin($, on, 10)).toBe(false)
})

test('play R1・R5・register: play がオン（既定）なら、10 分ひとりで歩く間にひとり遊びをする', { options: { doze_seconds: 3600 } }, async ($, on) => {
  expect(await playsWithin($, on, 10)).toBe(true)
})

// ---- テストが通ったら紙吹雪（.scratch/cheer/spec.md） --------------------------------

/**
 * 紙吹雪が描かれているか。桃（鉛筆の消しゴムと同じ色）と青（波乗りの水と同じ色）は、鉛筆も波乗りも無い場面では紙吹雪にしか出ない。
 * 紙片が道具や「!」と同じマスに入ると、そのマスでは色が混ざって消えることがあるので、2 色のどちらかで見る
 */
const hasConfetti = (cells: string) => cellColors(cells).has(0xf08fa8) || cellColors(cells).has(0x4a90d9)

test('cheer R1・契約 celebrate: 呼び出し元に CHEER_FRAMES 降らせ、降っている間なら戻す。いない id・消えきった 1 体では何もしない', () => {
  expect(CHEER_FRAMES).toBe(15)
  const crew = hereMain()
  const snapshot = JSON.stringify(crew)
  const cheered = celebrate(crew, MAIN)
  expect(JSON.stringify(crew)).toBe(snapshot)
  expect(cheered[0]!.cheer).toBe(CHEER_FRAMES)
  expect(advanceBy(cheered, 5, 200)[0]!.cheer).toBe(CHEER_FRAMES - 5)
  expect(celebrate(advanceBy(cheered, 5, 200), MAIN)[0]!.cheer).toBe(CHEER_FRAMES) // 戻す
  expect(celebrate(crew, 'nobody')).toEqual(crew)
  expect(celebrate(assemble(), MAIN)[0]!.cheer).toBe(0) // 消えきっている
})

test('cheer R2・契約 confettiPixels: 8 枚・5 色・2×2 でマスにそろい、同じマスに 2 枚入らず、3 コマで 1 マス落ち、下端で消える', () => {
  for (const x of [10, 11]) {
    const frames = Array.from({ length: CHEER_FRAMES }, (_, i) => confettiPixels(CHEER_FRAMES - i, 18, x))
    expect(new Set(frames.flat().map(p => p.color)).size).toBe(5)
    for (const frame of frames) {
      expect(frame.length % 4).toBe(0) // 2×2 の紙片だけ
      expect(frame.every(p => p.y >= 0 && p.y <= 5)).toBe(true)
      // マス（2×2）ごとに 1 色・4 ピクセルちょうど
      const cells = new Map<string, { color: number; count: number }>()
      for (const p of frame) {
        const key = `${Math.floor((x + p.dx) / 2)},${Math.floor(p.y / 2)}`
        const cell = cells.get(key) ?? { color: p.color, count: 0 }
        expect(cell.color).toBe(p.color)
        cells.set(key, { color: p.color, count: cell.count + 1 })
      }
      expect([...cells.values()].every(c => c.count === 4)).toBe(true)
    }
    expect(Math.max(...frames.map(f => f.length / 4))).toBe(8) // 8 枚がそろって見えるコマがある
    // 最初の紙片（いちばん左の赤）は 3 コマで 1 マス落ちる。赤はもう 1 枚（6 枚目）あるので、いちばん左のものを見る
    const redRow = (i: number) => {
      const reds = frames[i]!.filter(p => p.color === 0xe04f4f)
      const leftmost = Math.min(...reds.map(p => p.dx))
      return Math.min(...reds.filter(p => p.dx <= leftmost + 1).map(p => p.y))
    }
    expect([redRow(0), redRow(2), redRow(3), redRow(6)]).toEqual([0, 0, 2, 4])
    expect(confettiPixels(1, 18, x)).toEqual([]) // 最後のコマにはすべて落ちきっている
  }
})

test('cheer R4・R5: 紙吹雪は道具や歩きに重ねて描き、出入りの途中は描かない', () => {
  const held = celebrate(wield(hereMain(), MAIN, 'Bash', 'npm test'), MAIN)
  const actor = actors(held)[0]!
  expect(actor.confetti).toEqual({ left: CHEER_FRAMES })
  expect(actor.prop?.kind).toBe('flask') // R5: 道具はそのまま
  expect(actors(celebrate(setMain(hereMain(), false), MAIN))[0]!.confetti).toBeUndefined() // R4
  expect([0, 1, 2, 3].some(i => hasConfetti(paint(actors(advanceBy(held, i, 200)), 40)))).toBe(true)
})

test('cheer R1・R3・register: テストの Bash が成功したときだけ紙吹雪を降らせる', NO_PLAY, async ($, on) => {
  const clock = mock.clock(on)
  beneath(on)
  on('agent.list', async () => ({ value: [] }))
  let outcome: unknown = { result: 'ok' }
  on('tool.call', async () => outcome as never)
  const frames: string[] = []
  on('ui.blit', async (_$, e) => {
    if ('cells' in e) frames.push(e.cells)
    return { value: {} }
  })
  const ui = await $.ui.mount({ ...band(true, 60), surface: 'terminal' })
  await clock.advance(1500) // 現れきる
  const confettiAfter = async (input: unknown) => {
    const start = frames.length
    await $.tool.call(input as never)
    await clock.advance(1600)
    return frames.slice(start).some(hasConfetti)
  }
  expect(await confettiAfter({ tool: 'Bash', command: 'git status' })).toBe(false) // R3: テストでない
  outcome = { isError: true, result: 'failed' }
  expect(await confettiAfter({ tool: 'Bash', command: 'npm test' })).toBe(false) // R3: 失敗
  outcome = { result: 'ok' }
  expect(await confettiAfter({ tool: 'Bash', command: 'npm test' })).toBe(true) // R1
  await ui.unmount()
})

// ---- 会話の圧縮でぺしゃんこ（.scratch/squash/spec.md） --------------------------------

test('squash R2・契約 flatten: 下 3 行に縮み、左右に 1 ピクセル広がる', () => {
  const art = MASCOTS.clawd.draw('front', 'stand')
  const flat = flatten(art)
  expect(flat.length).toBe(MASCOT_HEIGHT)
  expect(flat[0]!.length).toBe(art[0]!.length + 2)
  expect(flat.slice(0, 3).flat().some(Boolean)).toBe(false)
  const lit = (rows: boolean[][]) => rows.flatMap(r => r.flatMap((on, x) => (on ? [x] : [])))
  expect(Math.min(...lit(flat))).toBe(Math.min(...lit(art))) // 左に 1 広がる（描くときに 1 左へずらす）
  expect(Math.max(...lit(flat))).toBe(Math.max(...lit(art)) + 2) // 右に 1 広がる
})

test('squash R2・R3・S1・S6・S11: 押しつぶされている間は歩かず道具・記号を描かず、終わると浮き 1・1・0・1・0 で戻って途切れが 0 に戻る', () => {
  const held = wield(hereMain(50), MAIN, 'Edit')
  const pressed = squeeze(held, MAIN)
  const actor = actors(pressed)[0]!
  expect(actor).toMatchObject({ squashed: true, x: 49 })
  expect(actor.prop).toBeUndefined()
  expect(actor.emote).toBeUndefined()
  expect(actors(poke(pressed, MAIN, true))[0]!.emote).toBeUndefined() // 驚いても記号は描かない
  const later = advanceBy(pressed, 30, 200)
  expect(later[0]!.wanderer.x).toBe(50) // 歩かない
  expect(later[0]!.idle).toBeGreaterThan(0)
  const released = unsqueeze(later, MAIN)
  expect(released[0]!.squash).toEqual({ kind: 'spring', left: SPRING_FRAMES })
  expect(released[0]!.idle).toBe(0)
  const lifts = [0, 1, 2, 3, 4].map(i => actors(advanceBy(released, i, 200))[0]!.lift ?? 0)
  expect(lifts).toEqual([1, 1, 0, 1, 0])
  const settled = advanceBy(released, SPRING_FRAMES, 200)
  expect(settled[0]!.squash).toBeNull()
  expect(advanceBy(settled, 1, 200)[0]!.wanderer.x).not.toBe(50) // また歩く
})

test('squash R4・R5・R6・S2・S8: 押しつぶしの間は行列・波乗りを始めず乗っている波乗りはやめ、引っ込められるとやめ、押しつぶされていなければ終わりで何もしない', () => {
  expect(startPlay(squeeze(soloMain(), MAIN), () => 0, 200)[0]!.play).toBeNull()
  expect(advance(squeeze(surfing(), MAIN), 200, () => 0.5)[0]!.play).toBeNull()
  const friends = sync(hereMain(), ['a'], () => 0, 200).map(m => (m.id === 'a' ? { ...m, presence: HERE } : m))
  expect(lineUp(squeeze(friends, MAIN), () => 0, 200)[0]!.parade).toBeNull()
  expect(advance(setMain(squeeze(hereMain(), MAIN), false), 200, () => 0.5)[0]!.squash).toBeNull() // R5
  const plain = hereMain()
  expect(unsqueeze(plain, MAIN)).toEqual(plain) // R6
  expect(squeeze(plain, 'nobody')).toEqual(plain)
})

/** 圧縮をテストから起こすためのプラグイン（会話を足す役と、CompactNow の呼び出しを合図に圧縮を起こす役） */
const COMPACTION = {
  ...NO_PLAY,
  plugins: [
    {
      name: 'transcript',
      tier: 'prepend',
      // テストから起こす圧縮には会話（messages）が付かないので、1 通だけの会話を足して下へ渡す（実際のセッションでは必ず付く）
      register(on) {
        on('session.compact', async ($, e, next) => next({ ...e, messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as never))
      },
    },
    {
      name: 'compactor',
      tier: 'prepend',
      // 圧縮を起こす役。$.session.compact は呼んだプラグインのフックを通らないので、テスト（＝clawd-wander の $）からではなく、
      // 別のプラグインから起こす。CompactNow という名前のツール呼び出しを合図にする
      register(on) {
        on('tool.call', async ($, e, next) => {
          if ((e as { tool: string }).tool !== 'CompactNow') return next(e)
          // 呼び出しの最中（ターンの途中）には圧縮できないので、呼び出しを返してから起こす
          $.clock.after(10, () => {
            $.session.compact({ instructions: 'test' }).catch(() => undefined)
          })
          return { result: 'ok' } as never
        })
      },
    },
  ],
}

test(
  'squash R1・R3・register: 会話の圧縮の間は帯の下半分だけに描かれ、終わると元の高さに戻る',
  COMPACTION,
  async ($, on) => {
    const clock = mock.clock(on)
    beneath(on)
    on('agent.list', async () => ({ value: [] }))
    let finish: (result: unknown) => void = () => undefined
    on('session.compact', () => new Promise(resolve => (finish = resolve)) as never)
    const frames: string[] = []
    on('ui.blit', async (_$, e) => {
      if ('cells' in e) frames.push(e.cells)
      return { value: {} }
    })
    const ui = await $.ui.mount({ ...band(true, 40), surface: 'terminal' })
    await clock.advance(1500) // 現れきる
    /** 最後のコマで、上 3 行のピクセルに何か描かれているか */
    const tall = () => pixels(decode(frames[frames.length - 1]!, 40).lines).slice(0, 3).flat().some(Boolean)
    expect(tall()).toBe(true)
    await $.tool.call({ tool: 'CompactNow' } as never)
    await clock.advance(500)
    expect(tall()).toBe(false) // 押しつぶされて下 3 行だけ
    finish({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] })
    await clock.advance(1000)
    expect(tall()).toBe(true) // 戻った
    await ui.unmount()
  },
)

test('squash R1・R5・S1: まだ現れていない本体も押しつぶし、押しつぶされたまま現れる。引っ込められたらやめる', () => {
  const pressed = squeeze(assemble(), MAIN)
  expect(pressed[0]!.squash).toEqual({ kind: 'pressed' })
  const appeared = advanceBy(setMain(pressed, true), FADE_FRAMES, 200)
  expect(appeared[0]!.presence.kind).toBe('here')
  expect(actors(appeared)[0]).toMatchObject({ squashed: true })
  expect(advance(setMain(appeared, false), 200, () => 0.5)[0]!.squash).toBeNull() // 引っ込められたらやめる
})

test(
  'squash R1・register: 本体が現れる前に圧縮が始まっても（/compact と同じ順番）、押しつぶされて現れる',
  COMPACTION,
  async ($, on) => {
    const clock = mock.clock(on)
    beneath(on)
    on('agent.list', async () => ({ value: [] }))
    let finish: (result: unknown) => void = () => undefined
    on('session.compact', () => new Promise(resolve => (finish = resolve)) as never)
    const frames: string[] = []
    on('ui.blit', async (_$, e) => {
      if ('cells' in e) frames.push(e.cells)
      return { value: {} }
    })
    const ui = await $.ui.mount({ ...band(false, 40), surface: 'terminal' }) // まだ作業していない（本体は消えきっている）
    await $.tool.call({ tool: 'CompactNow' } as never)
    await clock.advance(100)
    await ui.redraw(bandProps(true, 40)) // 作業が始まり、本体が現れる
    await clock.advance(2000)
    const tall = () => pixels(decode(frames[frames.length - 1]!, 40).lines).slice(0, 3).flat().some(Boolean)
    expect(frames.length).toBeGreaterThan(0)
    expect(tall()).toBe(false) // 押しつぶされて現れた
    finish({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] })
    await clock.advance(1000)
    expect(tall()).toBe(true)
    await ui.unmount()
  },
)

test('squash R7・契約 wantsMain: 押しつぶし・戻りの間は作業していなくても本体を出し、戻りきったら出さない', () => {
  const plain = hereMain()
  expect(wantsMain(plain, true)).toBe(true)
  expect(wantsMain(plain, false)).toBe(false)
  expect(wantsMain(sync(plain, ['a'], () => 0, 200), false)).toBe(true) // 仲間が動いている（always の R1）
  const pressed = squeeze(plain, MAIN)
  expect(wantsMain(pressed, false)).toBe(true)
  const springing = unsqueeze(pressed, MAIN)
  expect(wantsMain(springing, false)).toBe(true)
  expect(wantsMain(advanceBy(springing, SPRING_FRAMES, 200), false)).toBe(false)
})

test('squash R7・register: 作業が終わってから圧縮が終わっても、ぽよんと戻ってから消える', COMPACTION, async ($, on) => {
  const clock = mock.clock(on)
  beneath(on)
  on('agent.list', async () => ({ value: [] }))
  let finish: (result: unknown) => void = () => undefined
  on('session.compact', () => new Promise(resolve => (finish = resolve)) as never)
  const frames: string[] = []
  on('ui.blit', async (_$, e) => {
    if ('cells' in e) frames.push(e.cells)
    return { value: {} }
  })
  const ui = await $.ui.mount({ ...band(true, 40), surface: 'terminal' })
  await clock.advance(1500) // 現れきる
  await $.tool.call({ tool: 'CompactNow' } as never)
  await clock.advance(300)
  await ui.redraw(bandProps(false, 40)) // 作業が終わる（圧縮はまだ続いている）
  await clock.advance(1000)
  const lit = (cells: string) => pixels(decode(cells, 40).lines).flat().filter(Boolean).length
  const topLit = (cells: string) => pixels(decode(cells, 40).lines).slice(0, 3).flat().some(Boolean)
  expect(lit(frames[frames.length - 1]!)).toBeGreaterThan(20) // 作業が終わっても、つぶれたまま出ている
  expect(topLit(frames[frames.length - 1]!)).toBe(false)
  const ended = frames.length
  finish({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] })
  await clock.advance(3000)
  const after = frames.slice(ended)
  // 戻る間は元の高さで描かれ（浮きつき）、そのあと跳ねて消えていく
  expect(after.slice(0, 6).some(cells => topLit(cells) && lit(cells) > 30)).toBe(true)
  expect(lit(after[after.length - 1]!)).toBe(0)
  await ui.unmount()
})

// ---- ひとり遊び（.scratch/play/spec.md）・小踊り（.scratch/dance/spec.md）・蝶々（.scratch/butterfly/spec.md） ----

const dancing = (x = 50): Crew => beginPlay(soloMain(x), 'dance', 200)
const chasing = (x = 50): Crew => beginPlay(soloMain(x), 'butterfly', 200)

test('play R3・R4・R6: 遊びの間は行列もほかの遊びも始めず、歩けなくなる・引っ込められるとやめ、終わると立ち止まる', () => {
  for (const begin of [surfing, dancing, chasing]) {
    const crew = begin(50)
    expect(startPlay(crew, () => 0, 200)).toBe(crew) // R3: ほかの遊びは始めない
    const friends = sync(crew, ['a'], () => 0, 200).map(m => (m.id === 'a' ? { ...m, presence: HERE } : m))
    expect(lineUp(friends, () => 0, 200)[0]!.parade).toBeNull() // R3: 行列も始めない
    expect(advance(poke(crew, MAIN, true), 200, () => 0.5)[0]!.play).toBeNull() // R4: 驚く
    expect(advance(squeeze(crew, MAIN), 200, () => 0.5)[0]!.play).toBeNull() // R4: 押しつぶされる
    expect(advance(setMain(crew, false), 200, () => 0.5)[0]!.play).toBeNull() // R4: 引っ込められる
  }
  // R6: どの遊びも、終わると立ち止まってから歩き出す
  const danced = advanceBy(dancing(), DANCE_FRAMES, 200)
  expect(danced[0]!.play).toBeNull()
  expect(danced[0]!.wanderer.mode).toBe('pause')
})

test('dance R1・R2・R4・R5・R6: その場で 24 コマ踊り、拍ごとにバンザイ（左・右・左・右）と直立をくり返し、道具を描かない', () => {
  const crew = wield(dancing(50), MAIN, 'Edit')
  const poses = Array.from({ length: DANCE_FRAMES }, (_, i) => actors(advanceBy(crew, i, 200))[0]!)
  expect(poses.every(a => a.x === 50)).toBe(true) // R1: その場で
  expect(poses.every(a => a.prop === undefined)).toBe(true) // R4
  const beats = poses.filter((_, i) => i % 6 === 0).map(a => [a.pose, a.facing])
  expect(beats).toEqual([['banzai', 'left'], ['banzai', 'right'], ['banzai', 'left'], ['banzai', 'right']])
  expect(poses.filter((_, i) => i % 6 === 3).every(a => a.pose === 'stand' && a.facing === 'front')).toBe(true)
  expect(dancePose({ left: 1 })).toEqual({ pose: 'stand', facing: 'front' })
  expect(advanceBy(crew, DANCE_FRAMES, 200)[0]!.play).toBeNull() // R5
  expect(advance(sync(dancing(), ['a'], () => 0, 200), 200, () => 0.5)[0]!.play).toBeNull() // R6
})

test('dance R3: バンザイの絵は手が上にあり、胴の 3 行目の腕の張り出しが無い。ほかのマスコットは直立と同じ', () => {
  const up = MASCOTS.clawd.draw('front', 'banzai')
  const stand = MASCOTS.clawd.draw('front', 'stand')
  expect(up[0]![1]).toBe(true) // 左手
  expect(up[0]![16]).toBe(true) // 右手
  expect([1, 2, 15, 16].map(x => up[3]![x])).toEqual([false, false, false, false]) // 腕を消す
  expect([1, 2, 15, 16].map(x => stand[3]![x])).toEqual([true, true, true, true])
  expect(up[5]).toEqual(stand[5]) // 脚は直立と同じ
  expect(MASCOTS.ghost.draw('front', 'banzai')).toEqual(MASCOTS.ghost.draw('front', 'stand'))
})

test('butterfly R1・R2・R8・契約 butterflyPixels: 本体の前 12 ピクセル先の最上段に出て、2 ピクセルずつ進み、段と羽を替え、マスにそろえて黄色で描く', () => {
  const b = launch(68, 'right')
  expect(b).toMatchObject({ x: 68 + GAP, y: 0, phase: 'fly' })
  expect(launch(50, 'left').x).toBe(50 - GAP - 4)
  const crew = chasing(50)
  const flight = Array.from({ length: 12 }, (_, i) => advanceBy(crew, i, 200)[0]!.play as { x: number; y: number; t: number })
  expect(flight.map(f => f.x - flight[0]!.x).slice(0, 4)).toEqual([0, 2, 4, 6]) // R2: 2 ピクセルずつ
  expect(flight.map(f => f.y)).toEqual([0, 0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0]) // 4 コマごとに段を替える
  const shapes = new Set<string>()
  for (const f of flight) {
    const px = butterflyPixels(f as never)
    expect(px.every(p => p.color === 0xf2c94c)).toBe(true) // R8
    expect(px.length).toBe(4)
    // マスの区切り（左の端を偶数に切り下げた位置）からの形が ▚▞ か ▐▌（どちらも 2 マスに収まる）
    const anchor = Math.min(...px.map(p => p.x)) - (Math.min(...px.map(p => p.x)) % 2)
    const top = Math.min(...px.map(p => p.y))
    expect(top % 2).toBe(0)
    const shape = px.map(p => `${p.x - anchor},${p.y - top}`).sort().join(' ')
    expect(['0,0 1,1 2,1 3,0', '1,0 1,1 2,0 2,1']).toContain(shape)
    shapes.add(shape)
  }
  expect(shapes.size).toBe(2) // 羽を開閉する（▚▞ と ▐▌ が両方出る）
})

test('butterfly R3・R7: 本体は蝶々の 12 ピクセル手前まで 1 コマ 3 ピクセルまでで追い、追い越さず、道具を描かない', () => {
  const crew = wield(chasing(20), MAIN, 'Read')
  let prev = crew
  for (let i = 0; i < 30; i += 1) {
    const next = advance(prev, 300, () => 0.5)
    const main = next[0]!
    if (main.play?.kind !== 'butterfly' || main.play.phase !== 'fly') break
    expect(Math.abs(main.wanderer.x - prev[0]!.wanderer.x)).toBeLessThanOrEqual(3)
    expect(main.wanderer.x + MASCOTS.clawd.width).toBeLessThanOrEqual(main.play.x - GAP) // 追い越さない
    expect(actors(next)[0]!.prop).toBeUndefined() // R7
    prev = next
  }
  expect(prev[0]!.wanderer.x).toBeGreaterThan(20) // 追いかけて進んだ
})

test('butterfly R4・R5・R6・S2〜S7: 端か 5 秒で飛び去り、上へ消えたら 10 コマ見送って終わる。仲間が来ると飛び去る', () => {
  // 帯の端（幅 100）まで飛ぶと飛び去る
  let crew = chasing(10)
  let frames = 0
  while ((crew[0]!.play as { phase?: string } | null)?.phase === 'fly' && frames < 100) {
    crew = advance(crew, 100, () => 0.5)
    frames += 1
  }
  expect(frames).toBeLessThan(CHASE_FRAMES) // 帯の端で（5 秒より前に）飛び去った
  expect(crew[0]!.play).toMatchObject({ kind: 'butterfly', phase: 'away' })
  expect(crew[0]!.wanderer.facing).toBe('front') // R5: 見送る
  // 上へ消えたら見送り、WATCH_FRAMES で終わる
  crew = advanceBy(crew, 2, 100)
  expect(crew[0]!.play).toMatchObject({ phase: 'watch' })
  expect(advanceBy(crew, WATCH_FRAMES, 100)[0]!.play).toBeNull()
  // 広い帯では 5 秒で飛び去る
  const wide = advanceBy(chasing(10), CHASE_FRAMES, 2000)
  expect(wide[0]!.play).toMatchObject({ phase: 'away' })
  // R6: 仲間が来ると飛び去る
  expect(advance(sync(chasing(), ['a'], () => 0, 200), 200, () => 0.5)[0]!.play).toMatchObject({ phase: 'away' })
})

test('butterfly R2・R8・paint: 追いかけている間、帯に蝶々（黄色）を描く', () => {
  const crew = advanceBy(chasing(10), 2, 200)
  const cells = paint(actors(crew), 100)
  expect(cellColors(cells).has(0xf2c94c)).toBe(true)
})

