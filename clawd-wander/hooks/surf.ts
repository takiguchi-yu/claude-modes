// 本体の Clawd の波乗り（ひとり遊びの 1 つ。.scratch/play/spec.md）。いつ乗るかは play.ts と crew.ts、どう動くかは crew.ts が決め、
// ここは状態の進め方と、板・水面・波の絵を持つ。
//
// 乗っている間（ebb が null）は向かう側へ滑り、端に着くと波が引き（ebb が残りコマ）、引ききると降りる。
// 仕様は .scratch/surf/spec.md。顔ぶれも描画も Claude Code の API も知らない。

import type { Heading } from './parade'

/** 向かう側の奥行きがこれ以上あるときだけ始める（ピクセル。.scratch/play/spec.md の R2） */
export const MIN_RIDE = 30
/** 乗っている間に 1 コマで進むピクセル数（R2） */
export const SURF_PACE = 3
/** 波が引くコマ数（R4） */
export const EBB_FRAMES = 6

/** `ebb` が null なら乗っている、数なら引いている（残りコマ）。`age` は乗ってからのコマ数（波を動かすのに使う。R13） */
export type Surf = { readonly heading: Heading; readonly ebb: number | null; readonly age: number }

/** 波に乗る（R1） */
export const catchWave = (heading: Heading): Surf => ({ heading, ebb: null, age: 0 })

/** 波を引かせ始める（S5・S6）。引いている途中ならそのまま（S9） */
export const ebb = (s: Surf): Surf => (s.ebb !== null ? s : { ...s, ebb: EBB_FRAMES })

/** 乗っている波を 1 コマ進める（S4）。波を動かすために数えるだけ */
export const surge = (s: Surf): Surf => ({ ...s, age: s.age + 1 })

/** 引いている波を 1 コマ進める（S8）。引ききったら null */
export const recede = (s: Surf): Surf | null =>
  s.ebb === null ? s : s.ebb > 1 ? { ...s, ebb: s.ebb - 1, age: s.age + 1 } : null

/** 描く濃さ。乗っている間は 1、引いている間は残りの割合（R4） */
export const fadeOf = (s: Surf): number => (s.ebb === null ? 1 : s.ebb / EBB_FRAMES)

const BOARD = 0xf2c94c
const WATER = 0x4a90d9
const FOAM = 0xe8f4ff

/** 本体の絵の幅（板と反転の基準。mascots.ts の Clawd と同じ） */
const RIDER_WIDTH = 18

// 右へ進むときの波（本体の後ろ＝左）。左端を本体の左端から WAVE_AT ピクセル左に置く。
// `~` が波、`o` が泡、`.` が空き。本体の側（右）へ傾いて、頂上が本体の近くに来る（R9）
// 泡は 3 ピクセル。2 ピクセルだと、マスとの位置がずれたコマで泡のマスに空きが入り、青で描かれて消える
// R13: 波は SWELL_FRAMES コマごとに 4 つの形を順に回す。波頭が前へのめって崩れ、しぶきが本体の後ろへ飛んで落ちる。
// しぶき（波の右の `o`）は y = 0・1 の dx = -3〜1 だけに置く（波・本体と同じマスに入らない場所）
const WAVES = [
  ['.......ooo........', '......~~~~~~......', '....~~~~~~~~oo....', '..~~~~~~~~~~oo....', '~~~~~~~~~~~~~~....'],
  ['........ooo.......', '......~~~~~~~.....', '....~~~~~~~~~o....', '..~~~~~~~~~~~o....', '~~~~~~~~~~~~~~....'],
  ['..........oo....oo', '......~~~~~~ooo...', '....~~~~~~~~oo....', '..~~~~~~~~~~oo....', '~~~~~~~~~~~~~~....'],
  ['.............oo...', '......~~~~~oo...oo', '....~~~~~~~ooo....', '..~~~~~~~~~ooo....', '~~~~~~~~~~~~~~....'],
]
const WAVE_AT = -16
/** 波の形を替えるコマ数（R13） */
export const SWELL_FRAMES = 2
// R14: 板の先と後ろを交互に 1 ピクセル上げて揺らす（形の番号ごと。null は平ら）。
// R15: 板の先の前にしぶきを上げる（形の番号ごとの dx, y。板・本体・水面と同じマスに入らない y = 1〜3）
const TIP: readonly ('nose' | 'tail' | null)[] = ['nose', null, 'tail', null]
const BOW: readonly (readonly [number, number][])[] = [
  [[21, 2], [22, 2]],
  [[20, 2], [21, 2], [22, 3], [23, 3]],
  [[21, 1], [22, 1], [24, 2], [25, 2]],
  [[23, 2], [24, 3], [25, 3]],
]

/** 間引く順番（0〜7）。毎コマ同じ順番なので、ちらつかずに薄くなる */
const rank = (dx: number, y: number) => (((dx * 5 + y * 3) % 8) + 8) % 8

/**
 * 本体の左端を 0 とした、板・水面・波・泡のピクセル（R9）。y は帯の上端から（本体は 1 ピクセル浮かせて描く前提）。
 * 左へ進むときは本体の幅で左右反転する。fade が 1 未満なら、波と、板の真下を除く水面を決まった順に間引く。
 * 板と板の真下の水面は残す（1 マスに板の黄・水の青・空きが入ると 2 色を出せず、水まで黄で描かれるため）
 */
export function surfPixels(heading: Heading, fade: number, age = 0): { dx: number; y: number; color: number }[] {
  const pixels: { dx: number; y: number; color: number }[] = []
  const keep = (dx: number, y: number) => (rank(dx, y) + 0.5) / 8 < fade
  const shape = Math.floor(age / SWELL_FRAMES) % WAVES.length
  // 板: 脚の行（浮かせた後の 4 行目）に、本体の幅＋2。R14: 先か後ろを 1 ピクセル上げる
  for (let dx = -1; dx <= RIDER_WIDTH; dx += 1) pixels.push({ dx, y: 4, color: BOARD })
  if (TIP[shape] === 'nose') for (const dx of [RIDER_WIDTH, RIDER_WIDTH + 1]) pixels.push({ dx, y: 3, color: BOARD })
  if (TIP[shape] === 'tail') pixels.push({ dx: -1, y: 3, color: BOARD })
  // R15: 板の先のしぶき（波と同じく引いている間は間引く）
  for (const [dx, y] of BOW[shape]!) if (keep(dx, y)) pixels.push({ dx, y, color: FOAM })
  // 波: 本体の後ろ
  WAVES[shape]!.forEach((row, y) =>
    [...row].forEach((c, i) => {
      const dx = WAVE_AT + i
      if (c !== '.' && keep(dx, y)) pixels.push({ dx, y, color: c === 'o' ? FOAM : WATER })
    }),
  )
  // 水面: 最下行に、波の後ろの端から板の先＋2 まで、切れ目なく。板の真下は間引かない
  for (let dx = WAVE_AT; dx <= RIDER_WIDTH + 2; dx += 1) {
    const underBoard = dx >= -1 && dx <= RIDER_WIDTH
    if (underBoard || keep(dx, 5)) pixels.push({ dx, y: 5, color: WATER })
  }
  return heading === 'right' ? pixels : pixels.map(p => ({ ...p, dx: RIDER_WIDTH - 1 - p.dx }))
}
