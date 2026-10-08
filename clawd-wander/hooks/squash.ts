// 会話の圧縮でぺしゃんこになる。押しつぶされている間（pressed）と、終わってぽよんと戻る間（spring）。
// いつ押しつぶすかは register.ts と crew.ts が決め、ここは状態の進め方と、つぶれた絵の作り方を持つ。
// 仕様は .scratch/squash/spec.md。顔ぶれも描画も Claude Code の API も知らない。

/** 戻るのにかけるコマ数と、そのコマごとの浮き（R3） */
const SPRING_LIFTS = [1, 1, 0, 1, 0] as const
export const SPRING_FRAMES = SPRING_LIFTS.length

export type Squash = { readonly kind: 'pressed' } | { readonly kind: 'spring'; readonly left: number }

/** 押しつぶされている（R1・S1・S5・S9） */
export const PRESSED: Squash = { kind: 'pressed' }

/** 圧縮が終わった（S6）。押しつぶされていれば戻り始め、それ以外はそのまま（S2・S10） */
export const unpress = (s: Squash | null): Squash | null => (s?.kind === 'pressed' ? { kind: 'spring', left: SPRING_FRAMES } : s)

/** 1 コマ進む（S3・S7・S11）。戻りきったら null */
export const settle = (s: Squash | null): Squash | null =>
  s?.kind !== 'spring' ? s : s.left > 1 ? { kind: 'spring', left: s.left - 1 } : null

/** 戻っている間の浮き（R3）。それ以外は 0 */
export const liftOf = (s: Squash | null): number => (s?.kind === 'spring' ? SPRING_LIFTS[SPRING_FRAMES - s.left]! : 0)

/**
 * つぶれた絵（R2）。高さ 6 の絵の 2 行ずつを OR でまとめて下 3 行に置き、左右に 1 ピクセルずつ広げる（幅は元 + 2）。
 * 描くときは x を 1 ピクセル左にずらす
 */
export function flatten(bitmap: readonly (readonly boolean[])[]): boolean[][] {
  const width = bitmap[0]!.length
  const merged = [0, 2, 4].map(r => bitmap[r]!.map((on, x) => on || bitmap[r + 1]![x]!))
  const widen = (row: boolean[]) => Array.from({ length: width + 2 }, (_, x) => Boolean(row[x - 2] || row[x - 1] || row[x]))
  const blank = () => Array.from({ length: width + 2 }, () => false)
  return [blank(), blank(), blank(), ...merged.map(widen)]
}
