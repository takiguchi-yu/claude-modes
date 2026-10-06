// マスコットを Raster のセルに描く処理。
//
// 1 セルを横 2 × 縦 2 のピクセルとみなし、象限ブロック文字（▘ ▝ ▛ █ …）1 文字で表す。
// 半セル単位で位置をずらせるので、1 ピクセルずつ滑らかに歩ける。

import { type Facing, MASCOT_HEIGHT, type MascotId, MASCOTS, type Pose } from './mascots'

/** Raster の高さ（セル） */
export const SPRITE_ROWS = MASCOT_HEIGHT / 2

export const ORANGE = 0xd97757
const DEFAULT_COLOR = 0x01000000

/** 象限ブロック文字。添字のビットは 左上=8, 右上=4, 左下=2, 右下=1 */
const QUADRANTS = ' ▗▖▄▝▐▞▟▘▚▌▙▀▜▛█'

/** 帯に描く 1 体: どの絵か、左端からのピクセル位置、向き、ポーズ、色（0xRRGGBB） */
export type Actor = {
  readonly mascot: MascotId
  readonly x: number
  readonly facing: Facing
  readonly pose: Pose
  readonly color: number
  /** 0〜1。1 未満ならその割合だけピクセルを残し、残りを決まった順に間引く。省略は 1 */
  readonly opacity?: number
  /** 何ピクセル浮かせるか。帯の上端からはみ出す分は切る。省略は 0 */
  readonly lift?: number
}

// 4×4 の組織的ディザ（Bayer 行列）。ピクセルを間引く順番を決める表で、薄くなるにつれて
// 値の大きいピクセルから消える。毎コマ同じ順番なので、ちらつかずにじわっと薄くなる。
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]
const keeps = (dx: number, y: number, opacity: number) => (BAYER[y % 4]![dx % 4]! + 0.5) / 16 < opacity

/**
 * 幅 `columns` セル × SPRITE_ROWS 行の Raster の cells を作る。
 * 後ろの Actor ほど手前に描き、帯からはみ出す分は切る。
 * 1 セルに 2 色が重なったときは、そのセルで多いほうの色にする（同数なら手前）。
 */
export function paint(actors: readonly Actor[], columns: number): string {
  const width = columns * 2
  const height = SPRITE_ROWS * 2
  // 各ピクセルの色。-1 は空き
  const canvas = new Int32Array(width * height).fill(-1)
  for (const actor of actors) {
    const opacity = actor.opacity ?? 1
    const lift = actor.lift ?? 0
    MASCOTS[actor.mascot].draw(actor.facing, actor.pose).forEach((line, sy) =>
      line.forEach((on, dx) => {
        const x = actor.x + dx
        const y = sy - lift
        if (!on || x < 0 || x >= width || y < 0 || y >= height) return
        if (opacity < 1 && !keeps(dx, sy, opacity)) return
        canvas[y * width + x] = actor.color
      }),
    )
  }

  const words = new Uint32Array(columns * SPRITE_ROWS * 3)
  for (let row = 0; row < SPRITE_ROWS; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const quad = [
        canvas[row * 2 * width + col * 2]!,
        canvas[row * 2 * width + col * 2 + 1]!,
        canvas[(row * 2 + 1) * width + col * 2]!,
        canvas[(row * 2 + 1) * width + col * 2 + 1]!,
      ]
      const bits = quad.reduce((acc, color, i) => (color >= 0 ? acc | (8 >> i) : acc), 0)
      const at = (row * columns + col) * 3
      words[at] = QUADRANTS.codePointAt(bits)!
      words[at + 1] = bits === 0 ? DEFAULT_COLOR : dominant(quad)
      words[at + 2] = DEFAULT_COLOR
    }
  }
  return toBase64(new Uint8Array(words.buffer))
}

/** 空きを除いて最も多い色。同数なら後に出たほう */
function dominant(colors: readonly number[]): number {
  let best = -1
  let bestCount = 0
  for (const color of colors) {
    if (color < 0) continue
    const count = colors.filter(c => c === color).length
    if (count >= bestCount) {
      best = color
      bestCount = count
    }
  }
  return best
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
