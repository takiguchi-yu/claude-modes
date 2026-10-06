import type { AgentInfo, AgentStatus, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { actors, advance, agentCount, assemble, type Crew, isVisible, join, MAIN, MAX_AGENTS, setMain, sync } from '../hooks/crew'
import { FRIENDS, MASCOT_HEIGHT, type MascotId, MASCOTS } from '../hooks/mascots'
import { appear, elapse, FADE_FRAMES, GONE, HERE, retreat } from '../hooks/presence'
import { type Actor, ORANGE, paint, SPRITE_ROWS } from '../hooks/sprite'
import { poseOf, setOff, start, step, type Wanderer } from '../hooks/wander'

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
      for (const pose of ['stand', 'stepA', 'stepB'] as const) {
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

test('R10・S1・契約 step: 帯の中に収まり、1 コマの移動は 2 ピクセル以内で、左右どちらにも動く', () => {
  const maxX = 60
  const trail = wanderFor(20000, maxX)
  let previous = start()
  for (const w of trail) {
    expect(w.x).toBeGreaterThanOrEqual(0)
    expect(w.x).toBeLessThanOrEqual(maxX)
    expect(Math.abs(w.x - previous.x)).toBeLessThanOrEqual(2)
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

test('S1: 速さどおりに進む（ゆっくりは 2 コマで 1、ふつうは 1、小走りは 2 ピクセル）', () => {
  const moved = (gait: Wanderer['gait']) => {
    let w = walker({ gait, left: 40 })
    for (let i = 0; i < 10; i += 1) w = step(w, 200, () => 0.5)
    return w.x - 50
  }
  expect(moved('stroll')).toBe(5)
  expect(moved('walk')).toBe(10)
  expect(moved('dash')).toBe(20)
})

test('R1・R2: 歩き始めの距離と速さ', () => {
  // 乱数は「遠くまで行くか」「距離」「速さ」の順に使う
  expect(setOff(0, 'right', seq(0, 0, 0), 0)).toMatchObject({ mode: 'walk', left: 3, gait: 'stroll' })
  expect(setOff(0, 'right', seq(0.84, 0.999, 0.5), 0)).toMatchObject({ left: 14, gait: 'walk' })
  expect(setOff(0, 'right', seq(0.85, 0, 0.9), 0)).toMatchObject({ left: 20, gait: 'dash' })
  expect(setOff(0, 'right', seq(0.99, 0.999, 0.99), 0)).toMatchObject({ left: 50, gait: 'dash' })
  // 長い試行で比率を確かめる（遠くまで 15%・小走り 10%）
  const random = lcg(11)
  const starts = Array.from({ length: 4000 }, () => setOff(0, 'right', random, 0))
  const far = starts.filter(w => w.left >= 20).length / starts.length
  const dash = starts.filter(w => w.gait === 'dash').length / starts.length
  const stroll = starts.filter(w => w.gait === 'stroll').length / starts.length
  expect(Math.abs(far - 0.15)).toBeLessThan(0.03)
  expect(Math.abs(dash - 0.1)).toBeLessThan(0.03)
  expect(Math.abs(stroll - 0.35)).toBeLessThan(0.03)
})

test('R3・S2: 歩き終えたら、振り返ってすぐ歩く・立ち止まる・休むのどれか', () => {
  const finish = (...values: number[]) => step(walker({ left: 1 }), 200, seq(...values))
  const back = finish(0.2, 0, 0, 0.5)
  expect(back).toMatchObject({ mode: 'walk', facing: 'left', x: 51 })
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

test('R8: 向きを変えるまでに歩く距離は、平均で 20 ピクセル以下', () => {
  const trail = wanderFor(50000, 300)
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
  expect(mean).toBeLessThanOrEqual(20)
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

test('R8・S8・S12・R10: いる仲間は外れると F コマかけて消え、消えきったら顔ぶれから外れる', () => {
  let crew = sync(assemble(), ['a', 'b'], Math.random, 100)
  crew = advanceBy(crew, FADE_FRAMES) // 2 体ともいるになる
  crew = sync(crew, ['b'], Math.random, 100)
  expect(crew.map(m => [m.id, m.presence.kind])).toEqual([[MAIN, 'gone'], ['a', 'leaving'], ['b', 'here']])
  const kept = crew[2]!
  crew = advanceBy(crew, FADE_FRAMES)
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
  crew = sync(crew, ['b'], () => 0, 100) // a は消えかけ
  const joined = join(crew, 'c', () => 0.5, 100)
  expect(joined.map(m => [m.id, m.presence.kind])).toEqual([
    [MAIN, 'gone'],
    ['a', 'leaving'],
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
  expect(crew[0]!.wanderer.x).toBe(51)
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
  crew = advanceBy(crew, 4)
  const before = actors(crew)[0]!.opacity!
  crew = setMain(crew, true)
  expect(crew[0]!.presence).toEqual({ kind: 'arriving', left: 4 })
  expect(Math.abs(actors(crew)[0]!.opacity! - before)).toBeLessThan(1e-9)
  // 仲間も同じ。一覧に戻っても、起動の知らせでも、濃さを飛ばさない
  let agents = setMain(advanceBy(sync(assemble(), ['a'], () => 0, 100), FADE_FRAMES), false)
  agents = advanceBy(sync(agents, [], () => 0, 100), 5)
  expect(sync(agents, ['a'], () => 0, 100)[1]!.presence).toEqual({ kind: 'arriving', left: 5 })
  expect(join(agents, 'a', () => 0, 100)[1]!.presence).toEqual({ kind: 'arriving', left: 5 })
  // 消え始めた瞬間（濃さ 1）に出し直すと、そのままいる
  expect(appear(retreat(HERE))).toEqual(HERE)
})

test('R7・R12: 現れかけだけでも描くものがあり、全員いなくなると描かない', () => {
  expect(isVisible(setMain(assemble(), true))).toBe(true)
  const crew = advanceBy(setMain(advanceBy(setMain(assemble(), true), FADE_FRAMES), false), FADE_FRAMES)
  expect(isVisible(crew)).toBe(false)
  expect(actors(crew)).toHaveLength(0)
})

test('R8: 本体は作業が終わると浮き上がりながら薄くなって消え、顔ぶれには残る', () => {
  let crew = setMain(advanceBy(setMain(assemble(), true), FADE_FRAMES), false)
  const opacities: number[] = []
  const lifts: number[] = []
  while (isVisible(crew)) {
    const [main] = actors(crew)
    opacities.push(main!.opacity!)
    lifts.push(main!.lift!)
    crew = advanceBy(crew, 1)
  }
  expect(opacities).toHaveLength(FADE_FRAMES)
  expect(opacities[0]).toBe(1)
  expect(opacities.every((o, i) => i === 0 || o < opacities[i - 1]!)).toBe(true)
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

// ---- 帯への描画 ---------------------------------------------------------------

test('Claude が待機中なら何も描かない', async ($, on) => {
  beneath(on)
  const ui = await $.ui.mount({ ...band(false), surface: 'terminal' })
  expect(await ui.find({ key: 'clawd' })).toBeUndefined()
  await ui.unmount()
})

test('作業中はプロンプト上の帯に Clawd を描き、ほかの mod の分も残す', async ($, on) => {
  mock.clock(on)
  beneath(on)
  const ui = await $.ui.mount({ ...band(true, 40), surface: 'terminal' })
  const found = await ui.find({ key: 'clawd' })
  expect(found?.type).toBe('Raster')
  expect(found?.props).toMatchObject({ columns: 40, rows: SPRITE_ROWS })
  expect(await ui.find({ key: 'beneath' })).toBeDefined()
  await ui.unmount()
})

test('作業中は歩き回り、作業が終わると止まる', async ($, on) => {
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

test('サブエージェントが動いている間は色違いが増え、本体の作業が終わっても残る', async ($, on) => {
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

  // 本体の作業が終わっても、サブエージェントが動いていれば帯に残る（本体は消える）
  await ui.redraw(bandProps(false, 40))
  expect(await ui.find({ key: 'clawd' })).toBeDefined()
  await clock.advance(1500)
  expect(colorsNow().has(ORANGE)).toBe(false)
  expect(colorsNow().has(BLUE)).toBe(true)

  // サブエージェントも終わると、ふわっと消えてから帯ごと消え、止まる
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

test('書き換えが続けて通らなくても止まらず、帯を描き直させてから続ける', async ($, on) => {
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

test('タイマーが黙って終わっても、次のツール呼び出しで張り直す', async ($, on) => {
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

test('Raster の無い画面では描かない', async ($, on) => {
  mock.clock(on)
  beneath(on)
  const ui = await $.ui.mount({ ...band(true), surface: 'desktop' })
  expect(await ui.find({ key: 'clawd' })).toBeUndefined()
  await ui.unmount()
})
