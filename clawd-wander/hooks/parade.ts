// 本体が率いるカルガモ行列の道筋。本体が通った x を 1 ピクセルずつ覚え、何ピクセルさかのぼった所にいたかを返す。
//
// 本体は行列の向き（heading）へまっすぐ進み、仲間はこの道筋をたどって本体についていく。
// 顔ぶれも描画も Claude Code の API も知らない。仕様は .scratch/parade/spec.md。

/** 行列が進む向き */
export type Heading = 'left' | 'right'

/** 覚えておく道筋の長さ（ピクセル）。仲間 8 体が並ぶ間隔に足りる長さ */
export const TRAIL = 200

export type Parade = {
  /** 行列の残りコマ数 */
  readonly left: number
  /** 本体が進む向き。行列の間は変わらない */
  readonly heading: Heading
  /** 本体が通った x。古い順で、最後が本体のいまの位置 */
  readonly trail: readonly number[]
}

const clamp = (x: number, max: number) => Math.min(Math.max(x, 0), Math.max(0, max))

/** 行列を始める。道筋は本体の後ろ（heading の反対側）へまっすぐ延ばし、0〜maxX に収める（R2） */
export function begin(x: number, heading: Heading, maxX: number, frames: number): Parade {
  const behind = heading === 'left' ? 1 : -1
  const trail = Array.from({ length: TRAIL }, (_, i) => clamp(x + behind * (TRAIL - 1 - i), maxX))
  return { left: frames, heading, trail }
}

/** 本体が x に来た。道筋の最後から x まで 1 ピクセルずつ足し、古い分を捨てる（R3） */
export function record(p: Parade, x: number): Parade {
  const last = p.trail[p.trail.length - 1]!
  if (x === last) return p
  const dir = x > last ? 1 : -1
  // 帯が縮んで大きく飛んだときも、最後は x で終わるように後ろから数える
  const n = Math.min(Math.abs(x - last), TRAIL)
  const added = Array.from({ length: n }, (_, i) => x - dir * (n - 1 - i))
  return { ...p, trail: [...p.trail, ...added].slice(-TRAIL) }
}

/** 道筋を最後から offset ピクセルさかのぼった位置。道筋より長ければ最も古い位置 */
export const slot = (p: Parade, offset: number): number => p.trail[Math.max(0, p.trail.length - 1 - offset)]!
