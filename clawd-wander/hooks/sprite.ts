// マスコットを Raster のセルに描く処理。
//
// 1 セルを横 2 × 縦 2 のピクセルとみなし、象限ブロック文字（▘ ▝ ▛ █ …）1 文字で表す。
// 半セル単位で位置をずらせるので、1 ピクセルずつ滑らかに歩ける。

import { type Facing, MASCOT_HEIGHT, type MascotId, MASCOTS, type Pose } from './mascots'
import { propBitmap, type PropId } from './props'

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
  /** 絵の右横に描く記号。驚き（!）と居眠り（zZ。high で 1 行上） */
  readonly emote?: Emote
  /** 手に持つ道具。side の側に描き、raised なら 1 ピクセル上げる */
  readonly prop?: { readonly kind: PropId; readonly side: 'left' | 'right'; readonly raised: boolean }
}

export type Emote = { readonly kind: 'startle' } | { readonly kind: 'doze'; readonly high: boolean }

// 驚きの「!」はドット絵（高さ 6 の縦棒と点）。文字の「!」は小さくて見えなかったため。
const BANG = ['#', '#', '#', '#', '.', '#']

// 居眠りの z・Z はフォントの文字で、マス（2×2 ピクセル）に直接置く。
// ドット絵だと 1 マスに 2×2 ピクセルしか無く、z の斜めの線がつぶれて「工」に見えたため。
// 位置は記号の左端のマスからのずれ（列・行）
type Mark = { readonly char: string; readonly dx: number; readonly row: number }

function zMarks(high: boolean): readonly Mark[] {
  const base = high ? 0 : 1
  return [
    { char: 'z', dx: 0, row: base + 1 },
    { char: 'Z', dx: 1, row: base },
  ]
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
  // マスに直接置く文字（記号）。ピクセルの絵より手前に描く
  const texts: { col: number; row: number; char: string; color: number }[] = []
  for (const actor of actors) {
    const opacity = actor.opacity ?? 1
    const lift = actor.lift ?? 0
    const bitmap = MASCOTS[actor.mascot].draw(actor.facing, actor.pose)
    bitmap.forEach((line, sy) =>
      line.forEach((on, dx) => {
        const x = actor.x + dx
        const y = sy - lift
        if (!on || x < 0 || x >= width || y < 0 || y >= height) return
        if (opacity < 1 && !keeps(dx, sy, opacity)) return
        canvas[y * width + x] = actor.color
      }),
    )
    if (actor.prop !== undefined) {
      // 道具は絵の左右の端の塗りから 1 ピクセル空けて置く。帯からはみ出す分は切る
      const tool = propBitmap(actor.prop.kind, actor.prop.side)
      const toolWidth = tool[0]!.length
      const lit = bitmap.flatMap(row => row.flatMap((on, i) => (on ? [i] : [])))
      const left =
        actor.prop.side === 'right' ? actor.x + Math.max(...lit) + 2 : actor.x + Math.min(...lit) - 1 - toolWidth
      const dy = actor.prop.raised ? -1 : 0
      tool.forEach((row, ty) =>
        row.forEach((on, tx) => {
          const x = left + tx
          const y = ty + dy
          if (on && x >= 0 && x < width && y >= 0 && y < height) canvas[y * width + x] = actor.color
        }),
      )
    }
    if (actor.emote !== undefined) {
      // 記号はこのコマの絵の右端の塗りから 1 ピクセル以上空けて置く。帯からはみ出す分は切る
      const right = Math.max(...bitmap.map(row => row.lastIndexOf(true)))
      const left = actor.x + right + 2
      if (actor.emote.kind === 'startle') {
        BANG.forEach((c, y) => {
          if (c === '#' && left >= 0 && left < width) canvas[y * width + left] = actor.color
        })
      } else {
        const column = Math.ceil(left / 2)
        for (const mark of zMarks(actor.emote.high)) {
          texts.push({ col: column + mark.dx, row: mark.row, char: mark.char, color: actor.color })
        }
      }
    }
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
  for (const text of texts) {
    // 帯からはみ出す記号は描かない
    if (text.col < 0 || text.col >= columns || text.row < 0 || text.row >= SPRITE_ROWS) continue
    const at = (text.row * columns + text.col) * 3
    words[at] = text.char.codePointAt(0)!
    words[at + 1] = text.color
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
