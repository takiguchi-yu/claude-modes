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

/** `ebb` が null なら乗っている、数なら引いている（残りコマ） */
export type Surf = { readonly heading: Heading; readonly ebb: number | null }

/** 波に乗る（R1） */
export const catchWave = (heading: Heading): Surf => ({ heading, ebb: null })

/** 波を引かせ始める（S5・S6）。引いている途中ならそのまま（S9） */
export const ebb = (s: Surf): Surf => (s.ebb !== null ? s : { ...s, ebb: EBB_FRAMES })

/** 引いている波を 1 コマ進める（S8）。引ききったら null */
export const recede = (s: Surf): Surf | null => (s.ebb === null ? s : s.ebb > 1 ? { ...s, ebb: s.ebb - 1 } : null)

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
const WAVE = ['.......ooo....', '......~~~~~~..', '....~~~~~~~~~~', '..~~~~~~~~~~~~', '~~~~~~~~~~~~~~']
const WAVE_AT = -16

/** 間引く順番（0〜7）。毎コマ同じ順番なので、ちらつかずに薄くなる */
const rank = (dx: number, y: number) => (((dx * 5 + y * 3) % 8) + 8) % 8

/**
 * 本体の左端を 0 とした、板・水面・波・泡のピクセル（R9）。y は帯の上端から（本体は 1 ピクセル浮かせて描く前提）。
 * 左へ進むときは本体の幅で左右反転する。fade が 1 未満なら、波と、板の真下を除く水面を決まった順に間引く。
 * 板と板の真下の水面は残す（1 マスに板の黄・水の青・空きが入ると 2 色を出せず、水まで黄で描かれるため）
 */
export function surfPixels(heading: Heading, fade: number): { dx: number; y: number; color: number }[] {
  const pixels: { dx: number; y: number; color: number }[] = []
  const keep = (dx: number, y: number) => (rank(dx, y) + 0.5) / 8 < fade
  // 板: 脚の行（浮かせた後の 4 行目）に、本体の幅＋2
  for (let dx = -1; dx <= RIDER_WIDTH; dx += 1) pixels.push({ dx, y: 4, color: BOARD })
  // 波: 本体の後ろ
  WAVE.forEach((row, y) =>
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
