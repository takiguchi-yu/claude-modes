// Clawd の飾り（王冠・サングラス・ヘッドフォン・小鳥）。本体が現れるたびに 1 つ選ぶ（飾りなしもある）。
//
// 飾りは白く塗る点（dots）と、本体から抜く点（holes。小鳥の細目）で表す。どちらも絵の左上からのピクセル位置。
// 1 マス（2×2 ピクセル）は 2 色までしか描けず、空き・橙・白が同じマスに入ると崩れる。どの飾りも浮き 0 なら
// x の偶奇によらず崩れない形にしてある。形だけでは守れないもの（小鳥）は align で偶数ピクセルにそろえる列を指定し、
// 描く側が 1 ピクセルずらす。
// 仕様は .scratch/outfits/spec.md。描画も顔ぶれも Claude Code の API も知らない。

import { CLAWD_EYES, type Facing, type Pose } from './mascots'

export type OutfitId = 'crown' | 'shades' | 'headphones' | 'bird'

/** R1 で選ぶ飾り */
const OUTFITS: readonly OutfitId[] = ['crown', 'shades', 'headphones', 'bird']
/** 飾りを付けて現れる確率（R1）。主役は飾りなしの Clawd なので、たまにだけ付ける */
export const OUTFIT_CHANCE = 1 / 10

/** 飾りの白 */
export const OUTFIT_COLOR = 0xf2f0eb

export type Dot = { readonly dx: number; readonly y: number }

export type Look = {
  /** 白く塗る点 */
  readonly dots: readonly Dot[]
  /** 本体から抜く点（細目） */
  readonly holes: readonly Dot[]
  /** 列 column が帯で偶数ピクセルに来るよう、奇数なら nudge だけずらす（R12） */
  readonly align?: { readonly column: number; readonly nudge: 1 | -1 }
  /** 本体の横に張り出す側。その側に道具を描くコマは描かない（R8） */
  readonly side?: 'left' | 'right'
}

/**
 * 飾りを選ぶ（R1）。乱数が 1 - OUTFIT_CHANCE 未満なら飾りなし。それ以上なら、残りの区間を 4 等分して飾りを 1 つ選ぶ
 */
export function chooseOutfit(random: () => number): OutfitId | null {
  const r = random()
  const plain = 1 - OUTFIT_CHANCE
  if (r < plain) return null
  return OUTFITS[Math.min(OUTFITS.length - 1, Math.floor(((r - plain) / OUTFIT_CHANCE) * OUTFITS.length))]!
}

/** 文字で描いた行（# が白）を点にする。rows[0] が y = top */
const art = (top: number, ...rows: readonly string[]): Dot[] =>
  rows.flatMap((row, i) => [...row].flatMap((c, dx) => (c === '#' ? [{ dx, y: top + i }] : [])))

const NONE: Look = { dots: [], holes: [] }

const CROWN = art(0, '...#....##....#...', '...############...')
const CROWN_SLEEP = art(0, '.....#..##..#.....', '.....########.....')
const HEADPHONES = art(0, '...############...', '..##..........##..')
const HEADPHONES_SLEEP = art(0, '.....########.....', '....#........#....')
const BIRD_PERCHED = art(0, '........#.#.......', '.........#........')
/** 頭の横を飛ぶ小鳥（v の字）。左端の x を受け取る */
const bird = (left: number): Dot[] => [
  { dx: left, y: 0 },
  { dx: left + 2, y: 0 },
  { dx: left + 1, y: 1 },
]

/** サングラスのレンズ（目を含む 3 ピクセル。x = 4〜13 に収めて、空きと同じマスに入れない） */
const lens = (eye: number): Dot[] => {
  const from = Math.max(4, Math.min(11, eye - 1))
  return [0, 1, 2].map(i => ({ dx: from + i, y: 2 }))
}

/** 向きとポーズに合わせた飾りの見え方（R5・R7・R9〜R12） */
export function outfitLook(outfit: OutfitId, facing: Facing, pose: Pose): Look {
  const sleeping = pose === 'sleep'
  const [leftEye, rightEye] = CLAWD_EYES[facing]
  switch (outfit) {
    case 'crown':
      return { dots: sleeping ? CROWN_SLEEP : CROWN, holes: [] }
    case 'shades':
      return sleeping ? NONE : { dots: [...lens(leftEye), ...lens(rightEye)], holes: [] }
    case 'headphones':
      return { dots: sleeping ? HEADPHONES_SLEEP : HEADPHONES, holes: [] }
    case 'bird': {
      if (sleeping) return { dots: BIRD_PERCHED, holes: [] }
      const holes = [
        { dx: leftEye + 1, y: 2 },
        { dx: rightEye - 1, y: 2 },
      ]
      return facing === 'right'
        ? { dots: bird(-1), holes, align: { column: 0, nudge: 1 }, side: 'left' }
        : { dots: bird(16), holes, align: { column: 16, nudge: -1 }, side: 'right' }
    }
  }
}
