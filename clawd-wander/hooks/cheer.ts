// テストが通ったときの紙吹雪。持ち主の真ん中を中心に 8 枚の紙片を上から落とす。
// いつ降らせるかは register.ts と crew.ts が決め、ここは紙片の絵だけを持つ。
// 仕様は .scratch/cheer/spec.md。顔ぶれも描画も Claude Code の API も知らない。

/** 紙吹雪を降らせるコマ数（1.5 秒。R1） */
export const CHEER_FRAMES = 15

/** 紙片の色（赤・黄・緑・青・桃。R2） */
const COLORS = [0xe04f4f, 0xf2c94c, 0x5cd67a, 0x4a90d9, 0xf08fa8]
/** 紙片の数と間隔（ピクセル）。マスにそろえても隣どうしが同じマスに入らない間隔 */
const PIECES = 8
const SPACING = 4
/** 紙片ごとの、落ち始めるまでのコマ数。そろって落ちないように少しずつずらす（最後の紙片も CHEER_FRAMES のうちに落ちきる） */
const DELAYS = [0, 3, 1, 5, 2, 4, 1, 3]
/** 1 マス落ちるのにかけるコマ数と、帯の高さ（マス） */
const FRAMES_PER_ROW = 3
const ROWS = 3

/** 偶数に切り下げる（負の数も） */
const even = (n: number) => n - (((n % 2) + 2) % 2)

/**
 * 持ち主の左端を 0 とした紙片のピクセル（R2）。`left` は残りコマ（1〜CHEER_FRAMES）、`width` は持ち主の絵の幅、
 * `x` は持ち主の左端の帯でのピクセル位置。紙片は 2×2 で、帯のマスの区切りにそろえて置く。
 * 同じ引数なら同じ結果（毎コマ同じ順番で落ちる）
 */
export function confettiPixels(left: number, width: number, x: number): { dx: number; y: number; color: number }[] {
  const t = CHEER_FRAMES - left
  const first = Math.floor(width / 2) - Math.floor(((PIECES - 1) * SPACING) / 2)
  const pixels: { dx: number; y: number; color: number }[] = []
  for (let i = 0; i < PIECES; i += 1) {
    if (t < DELAYS[i]!) continue
    const row = Math.floor((t - DELAYS[i]!) / FRAMES_PER_ROW)
    if (row >= ROWS) continue
    // マスの区切り（帯での位置が偶数）にそろえる
    const dx = even(x + first + i * SPACING) - x
    const color = COLORS[i % COLORS.length]!
    for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) pixels.push({ dx: dx + ox, y: row * 2 + oy, color })
  }
  return pixels
}
