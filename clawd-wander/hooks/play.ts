// ひとり遊び。本体がひとりで歩いている間、ときどき遊びを 1 つ始める（波乗り・小踊り・蝶々）。
// ここは「どの遊びを始められるか」と頻度、遊びの状態の型を持つ。本体をどう動かすかは crew.ts が決める。
// 仕様は .scratch/play/spec.md。顔ぶれも描画も Claude Code の API も知らない。

import type { Butterfly } from './butterfly'
import { MIN_CHASE } from './butterfly'
import type { Dance } from './dance'
import type { Surf } from './surf'
import { MIN_RIDE } from './surf'

/** ひとり遊びを始める確率（1 コマあたり。平均でおよそ 1 分に 1 回。R1） */
export const PLAY_CHANCE = 1 / 600

export type PlayKind = 'surf' | 'dance' | 'butterfly'

/** 本体がしているひとり遊び。種類ごとの状態は各モジュールの型 */
export type Play =
  | ({ readonly kind: 'surf' } & Surf)
  | ({ readonly kind: 'dance' } & Dance)
  | ({ readonly kind: 'butterfly' } & Butterfly)

/**
 * 始められる遊び（R2）。`x` は本体の位置、`room` は置ける x の最大（ピクセル）。
 * 波乗りと蝶々は、帯の広いほうの奥行きが足りるときだけ。小踊りはいつでも
 */
export function playable(x: number, room: number): PlayKind[] {
  const reach = Math.max(room - x, x)
  const kinds: PlayKind[] = []
  if (reach >= MIN_RIDE) kinds.push('surf')
  kinds.push('dance')
  if (reach >= MIN_CHASE) kinds.push('butterfly')
  return kinds
}
