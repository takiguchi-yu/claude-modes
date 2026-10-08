// 蝶々を追いかける（ひとり遊びの 1 つ）。蝶々がひらひら飛び、帯の端で折り返し、時間切れで上へ飛び去り、本体が見送る。
// 本体をどう動かすかは crew.ts が決め、ここは蝶々の状態の進め方と絵を持つ。
// 仕様は .scratch/butterfly/spec.md。顔ぶれも描画も Claude Code の API も知らない。

import type { Heading } from './parade'

/** 向かう側の奥行きがこれ以上あるときだけ始める（ピクセル。.scratch/play/spec.md の R2） */
export const MIN_CHASE = 60
/** 蝶々が 1 コマで進むピクセル数（R2）と、本体の前の端から空ける距離（R1・R3） */
export const FLY_PACE = 2
export const GAP = 12
/** 飛んでいられるコマ数（15 秒。R4）と、飛び去ったあと見送るコマ数（R5） */
export const CHASE_FRAMES = 150
export const WATCH_FRAMES = 10
/** 蝶々の幅（ピクセル。R2）と色（R8） */
export const WIDTH = 4
const COLOR = 0xf2c94c

/** x・y は蝶々の左上（帯でのピクセル）。t は飛び始めてからのコマ数。left は見送りの残りコマ */
export type Butterfly = {
  readonly heading: Heading
  readonly x: number
  readonly y: number
  readonly t: number
  readonly phase: 'fly' | 'away' | 'watch'
  readonly left: number
}

/** 蝶々を出す（R1）。`front` は本体の向かう側の端（右なら絵の右端の次、左なら左端）のピクセル */
export const launch = (front: number, heading: Heading): Butterfly => ({
  heading,
  x: heading === 'right' ? front + GAP : front - GAP - WIDTH,
  y: 0,
  t: 0,
  phase: 'fly',
  left: 0,
})

/** 飛び去らせる（R4・R6・S2・S3）。飛び去っている・見送っているならそのまま（S5・S7） */
export const scare = (b: Butterfly): Butterfly => (b.phase === 'fly' ? { ...b, phase: 'away' } : b)

/** 1 コマ進める（S1・S2・S4・S6）。`width` は帯の幅（ピクセル）。帯の端では折り返す（R9）。見送り終えたら null */
export function flutter(b: Butterfly, width: number): Butterfly | null {
  const t = b.t + 1
  switch (b.phase) {
    case 'fly': {
      if (t >= CHASE_FRAMES) return { ...b, t, phase: 'away' }
      const y = Math.floor(t / 4) % 2 === 0 ? 0 : 2
      const x = b.x + (b.heading === 'right' ? FLY_PACE : -FLY_PACE)
      // R9: 次で端を越えるなら、その場で折り返す
      if (x < 0 || x > width - WIDTH) return { ...b, t, y, heading: b.heading === 'right' ? 'left' : 'right' }
      return { ...b, x, t, y }
    }
    case 'away': {
      // 前へ 2 ピクセル進みながら 1 マス昇る（斜め上へ飛び去る）。帯の上端より上に出たら見送りへ
      const x = b.x + (b.heading === 'right' ? FLY_PACE : -FLY_PACE)
      return b.y - 2 >= 0 ? { ...b, t, x, y: b.y - 2 } : { ...b, t, phase: 'watch', left: WATCH_FRAMES }
    }
    case 'watch':
      return b.left > 1 ? { ...b, t, left: b.left - 1 } : null
  }
}

/** 偶数に切り下げる（負の数も） */
const even = (n: number) => n - (((n % 2) + 2) % 2)

// 羽の形（左上からのずれ）。開くと左右のマスに斜めの羽（▚▞）、閉じると真ん中の 2 列（▐▌）
const OPEN = [[0, 0], [3, 0], [1, 1], [2, 1]] as const
const CLOSED = [[1, 0], [2, 0], [1, 1], [2, 1]] as const

/**
 * 蝶々のピクセル（R2・R8）。帯での x・y と色。左上をマスの区切り（偶数）にそろえ、2 コマごとに羽を開閉する。
 * 見送っている間は空
 */
export function butterflyPixels(b: Butterfly): { x: number; y: number; color: number }[] {
  if (b.phase === 'watch') return []
  const x = even(b.x)
  const y = even(b.y)
  const open = Math.floor(b.t / 2) % 2 === 0
  return (open ? OPEN : CLOSED).map(([dx, dy]) => ({ x: x + dx, y: y + dy, color: COLOR }))
}
