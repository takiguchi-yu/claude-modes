// マスコットを Raster のセルに描く処理。
//
// 1 セルを横 2 × 縦 2 のピクセルとみなし、象限ブロック文字（▘ ▝ ▛ █ …）1 文字で表す。
// 半セル単位で位置をずらせるので、1 ピクセルずつ滑らかに歩ける。

import { type Facing, MASCOT_HEIGHT, type MascotId, MASCOTS, type Pose } from './mascots'
import type { Heading } from './parade'
import { PROP_GAP, propPixels, type PropId } from './props'
import { surfPixels } from './surf'
import { confettiPixels } from './cheer'
import { flatten } from './squash'

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
  /** 波乗り（.scratch/surf/spec.md の R9）。1 ピクセル浮かせて脚を描かず、板・水面・波を描く。fade は波と水面の濃さ */
  readonly surf?: { readonly heading: Heading; readonly fade: number }
  /** 紙吹雪（.scratch/cheer/spec.md）。left は残りコマ */
  readonly confetti?: { readonly left: number }
  /** 会話の圧縮で押しつぶされている（.scratch/squash/spec.md の R2）。つぶれた絵（幅 + 2）で描く */
  readonly squashed?: true
}

export type Emote = { readonly kind: 'startle' } | { readonly kind: 'doze'; readonly high: boolean }

/**
 * 記号が、絵の右端（x + 幅）からさらに何ピクセル右まで描かれうるか（行列の間隔に使う。.scratch/parade-rejoin/spec.md の R7）。
 * 記号は、そのコマの絵の右端の塗りから 2 ピクセル右に置く。驚きは震えの 1 ピクセルを、
 * 居眠りはマスへの寄せ（最大 1 ピクセル）と、右隣のマスに置く Z の分を含む
 */
export function emoteReach(mascot: MascotId, kind: Emote['kind']): number {
  const bitmap = MASCOTS[mascot].draw('front', kind === 'startle' ? 'stand' : 'sleep')
  const right = Math.max(...bitmap.map(row => row.lastIndexOf(true)))
  // 記号の右端（絵の左端からのピクセル、含まない）。「!」は 1 列＋震え 1、zZ は寄せ 1＋2 マス（4 ピクセル）
  const end = kind === 'startle' ? right + 2 + 1 + 1 : right + 2 + 1 + 4
  return Math.max(0, end - MASCOTS[mascot].width)
}

// 驚きの「!」はドット絵（高さ 6 の縦棒と点）。文字の「!」は小さくて見えなかったため。
const BANG = ['#', '#', '#', '#', '.', '#']
/** 「!」の色。持ち主の色ではなく赤で描く（2026-10-07 にユーザーの希望で変更。emotes の R4） */
export const BANG_COLOR = 0xe04f4f

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
 * 濃さ 1 の Actor は、その塗りから 1 ピクセル以内にある先の Actor のピクセルを消してから描く
 * （重なっても輪郭が切り離されて見分けられる。.scratch/overlap/spec.md）。
 * 1 セルに 2 色が重なったときは、そのセルで多いほうの色にする（同数なら手前）。
 */
export function paint(actors: readonly Actor[], columns: number): string {
  const width = columns * 2
  const height = SPRITE_ROWS * 2
  // 各ピクセルの色。-1 は空き
  const canvas = new Int32Array(width * height).fill(-1)
  // 各ピクセルを描いた Actor の番号。-1 は空き
  const owner = new Int32Array(width * height).fill(-1)
  // マスに直接置く文字（記号）。ピクセルの絵より手前に描く
  const texts: { col: number; row: number; char: string; color: number }[] = []
  // overlap の R6: 道具を見せている者は手前に描く（奥に入った子の道具が、手前の子のものに見えないように）
  const ordered = [...actors.filter(actor => actor.prop === undefined), ...actors.filter(actor => actor.prop !== undefined)]
  ordered.forEach((actor, index) => {
    // この Actor が塗るピクセル（canvas の添字）と、持ち主の色以外で塗るピクセルの色（道具。props の R22）
    const dots: number[] = []
    const tinted = new Map<number, number>()
    const opacity = actor.opacity ?? 1
    // surf の R9: 波乗りの間は 1 ピクセル浮かせ、脚の行（最下行）を描かない
    const lift = actor.surf !== undefined ? 1 : (actor.lift ?? 0)
    const drawn = MASCOTS[actor.mascot].draw(actor.facing, actor.pose)
    const bitmap = actor.squashed ? flatten(drawn) : drawn
    bitmap.forEach((line, sy) =>
      line.forEach((on, dx) => {
        const x = actor.x + dx
        const y = sy - lift
        if (actor.surf !== undefined && sy === MASCOT_HEIGHT - 1) return
        if (!on || x < 0 || x >= width || y < 0 || y >= height) return
        if (opacity < 1 && !keeps(dx, sy, opacity)) return
        dots.push(y * width + x)
      }),
    )
    if (actor.prop !== undefined) {
      // 道具は絵の左右の端の塗りから PROP_GAP（1 ピクセル）空けて置く。向いている側で帯からはみ出し、
      // 反対側なら収まるときは、反対の手に持つ（props の R21）。どちらにも収まらなければ、はみ出す分は切る
      const { kind } = actor.prop
      const lit = bitmap.flatMap(row => row.flatMap((on, i) => (on ? [i] : [])))
      const right = actor.x + Math.max(...lit) + 1 + PROP_GAP // 右に置くときの左端（ピクセル）
      const left = actor.x + Math.min(...lit) - PROP_GAP // 左に置くときの右端の次（ピクセル）
      const place = (side: 'left' | 'right') => {
        const tool = propPixels(kind, side, actor.color)
        const toolWidth = tool[0]!.length
        const at = side === 'right' ? right : left - toolWidth
        return { tool, at, fits: at >= 0 && at + toolWidth <= width }
      }
      const facing = place(actor.prop.side)
      const other = place(actor.prop.side === 'right' ? 'left' : 'right')
      const { tool, at } = !facing.fits && other.fits ? other : facing
      const dy = actor.prop.raised ? -1 : 0
      tool.forEach((row, ty) =>
        row.forEach((color, tx) => {
          const x = at + tx
          const y = ty + dy
          if (color === null || x < 0 || x >= width || y < 0 || y >= height) return
          dots.push(y * width + x)
          if (color !== actor.color) tinted.set(y * width + x, color)
        }),
      )
    }
    if (actor.surf !== undefined) {
      // 板・水面・波は本体の塗りとして描く（重なりの輪郭は本体と一緒に扱う）
      for (const { dx, y, color } of surfPixels(actor.surf.heading, actor.surf.fade)) {
        const x = actor.x + dx
        if (x < 0 || x >= width || y < 0 || y >= height) continue
        dots.push(y * width + x)
        tinted.set(y * width + x, color)
      }
    }
    if (actor.confetti !== undefined) {
      // 紙吹雪は持ち主の塗りとして描く（浮きに関係なく帯の上から落ちる）
      for (const { dx, y, color } of confettiPixels(actor.confetti.left, MASCOTS[actor.mascot].width, actor.x)) {
        const x = actor.x + dx
        if (x < 0 || x >= width || y < 0 || y >= height) continue
        dots.push(y * width + x)
        tinted.set(y * width + x, color)
      }
    }
    if (actor.emote !== undefined) {
      // 記号はこのコマの絵の右端の塗りから 1 ピクセル以上空けて置く。帯からはみ出す分は切る
      const right = Math.max(...bitmap.map(row => row.lastIndexOf(true)))
      const left = actor.x + right + 2
      if (actor.emote.kind === 'startle') {
        BANG.forEach((c, y) => {
          if (c !== '#' || left < 0 || left >= width) return
          dots.push(y * width + left)
          tinted.set(y * width + left, BANG_COLOR)
        })
      } else {
        const column = Math.ceil(left / 2)
        for (const mark of zMarks(actor.emote.high)) {
          texts.push({ col: column + mark.dx, row: mark.row, char: mark.char, color: actor.color })
        }
      }
    }
    if (opacity >= 1) {
      // R1: 塗りから 1 ピクセル以内（斜めを含む）にある、先の Actor のピクセルを消す。
      // 薄くなっている途中の Actor は、まばらな塗りで奥に穴を開けないよう消さない（R3）
      for (const dot of dots) {
        const x = dot % width
        const y = (dot - x) / width
        for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny += 1) {
          for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx += 1) {
            const near = ny * width + nx
            if (owner[near]! >= 0 && owner[near] !== index) {
              canvas[near] = -1
              owner[near] = -1
            }
          }
        }
      }
    }
    for (const dot of dots) {
      canvas[dot] = tinted.get(dot) ?? actor.color
      owner[dot] = index
    }
  })

  const words = new Uint32Array(columns * SPRITE_ROWS * 3)
  for (let row = 0; row < SPRITE_ROWS; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const quad = [
        canvas[row * 2 * width + col * 2]!,
        canvas[row * 2 * width + col * 2 + 1]!,
        canvas[(row * 2 + 1) * width + col * 2]!,
        canvas[(row * 2 + 1) * width + col * 2 + 1]!,
      ]
      const at = (row * columns + col) * 3
      const used = [...new Set(quad.filter(color => color >= 0))]
      if (used.length === 2 && !quad.includes(-1)) {
        // 2 色で空きが無いマスは、多いほうを文字の色、少ないほうを背景の色にする（道具の色分け。props の R22）
        const fore = dominant(quad)
        words[at] = QUADRANTS.codePointAt(quad.reduce((acc, color, i) => (color === fore ? acc | (8 >> i) : acc), 0))!
        words[at + 1] = fore
        words[at + 2] = used.find(color => color !== fore)!
        continue
      }
      const bits = quad.reduce((acc, color, i) => (color >= 0 ? acc | (8 >> i) : acc), 0)
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
