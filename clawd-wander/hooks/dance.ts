// 小踊り（ひとり遊びの 1 つ）。その場で 4 拍、バンザイと直立をくり返す。
// いつ始めるかは play.ts と crew.ts が決め、ここは拍の進め方と、そのコマのポーズを持つ。
// 仕様は .scratch/dance/spec.md。顔ぶれも描画も Claude Code の API も知らない。

import type { Facing, Pose } from './mascots'

/** 1 拍のコマ数（前半がバンザイ、後半が直立）と拍の数（R2） */
const BEAT_FRAMES = 6
const RAISED_FRAMES = 3
const BEATS = 4
export const DANCE_FRAMES = BEAT_FRAMES * BEATS

/** `left` は残りコマ（1〜DANCE_FRAMES） */
export type Dance = { readonly left: number }

export const startDance = (): Dance => ({ left: DANCE_FRAMES })

/** 1 コマ進める。踊り終えたら null（R5） */
export const stepDance = (d: Dance): Dance | null => (d.left > 1 ? { left: d.left - 1 } : null)

/** そのコマのポーズ（R2）。拍の前半はバンザイ（拍ごとに左・右・左・右を向く）、後半は正面で直立 */
export function dancePose(d: Dance): { pose: Extract<Pose, 'banzai' | 'stand'>; facing: Facing } {
  const t = DANCE_FRAMES - d.left
  const beat = Math.floor(t / BEAT_FRAMES)
  if (t % BEAT_FRAMES < RAISED_FRAMES) return { pose: 'banzai', facing: beat % 2 === 0 ? 'left' : 'right' }
  return { pose: 'stand', facing: 'front' }
}
