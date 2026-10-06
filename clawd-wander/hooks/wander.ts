// うろうろする動き。1 コマ（TICK_MS）ごとに step で次の状態を返す純粋関数。
//
// 短い距離を行ったり来たりする。歩き終えたら、振り返ってすぐ引き返すか、少し立ち止まるか、
// きょろきょろしながら休む。速さはゆっくり・ふつう・小走りの 3 段。ときどき遠くまで歩く。
// 端に着いたら引き返す。描画も Claude Code の API も知らない。
// 仕様は .scratch/wander/spec.md（状態遷移表 S1〜S9）。

import type { Facing, Pose } from './mascots'

/** 歩く速さ。stroll は 2 コマで 1 ピクセル、walk は 1 コマで 1 ピクセル、dash は 1 コマで 2 ピクセル */
export type Gait = 'stroll' | 'walk' | 'dash'

export type Wanderer = {
  /** 左端からのピクセル位置 */
  readonly x: number
  readonly facing: Facing
  readonly mode: 'walk' | 'pause' | 'rest'
  /** walk は残り距離（ピクセル）、pause・rest は残りコマ数 */
  readonly left: number
  /** walk の速さ。pause・rest では使わない */
  readonly gait: Gait
  /** 経過コマ数。ゆっくり歩くときの拍に使う */
  readonly frame: number
}

export const start = (): Wanderer => ({ x: 0, facing: 'front', mode: 'rest', left: 5, gait: 'walk', frame: 0 })

/** 歩いている間は位置が 2 ピクセル変わるごとに脚を入れ替え、止まっている間は直立（R7） */
export const poseOf = (w: Wanderer): Pose =>
  w.mode !== 'walk' ? 'stand' : Math.floor(w.x / 2) % 2 === 0 ? 'stepA' : 'stepB'

const between = (random: () => number, min: number, max: number) => min + Math.floor(random() * (max - min + 1))

const turned = (facing: Facing): Facing => (facing === 'left' ? 'right' : 'left')

/** このコマに進むピクセル数 */
const pace = (gait: Gait, frame: number) => (gait === 'dash' ? 2 : gait === 'walk' ? 1 : frame % 2)

/**
 * 歩き出す（R1・R2）。乱数は「遠くまで行くか」「距離」「速さ」の順に使う。
 */
export function setOff(x: number, facing: Facing, random: () => number, frame: number): Wanderer {
  const isFar = random() >= 0.85
  const left = isFar ? between(random, 20, 50) : between(random, 3, 14)
  const g = random()
  const gait: Gait = g < 0.35 ? 'stroll' : g < 0.9 ? 'walk' : 'dash'
  return { x, facing, mode: 'walk', left, gait, frame }
}

/** 歩き終えた（R3・S2）。振り返ってすぐ歩く・立ち止まる・休むのどれか */
function arrive(x: number, facing: Facing, random: () => number, frame: number): Wanderer {
  const r = random()
  if (r < 0.45) return setOff(x, turned(facing), random, frame)
  if (r < 0.8) return { x, facing, mode: 'pause', left: between(random, 2, 6), gait: 'walk', frame }
  return { x, facing, mode: 'rest', left: between(random, 10, 30), gait: 'walk', frame }
}

/**
 * 次のコマの状態。`maxX` は置ける x の最大（帯の幅 − 絵の幅、ピクセル）。負なら 0 とみなす。
 * 帯の幅が縮んでいても、まず x をその中に収める。
 */
export function step(w: Wanderer, maxX: number, random: () => number): Wanderer {
  const limit = Math.max(0, maxX)
  const x = Math.min(Math.max(w.x, 0), limit)
  const frame = w.frame + 1

  switch (w.mode) {
    case 'walk': {
      const dx = (w.facing === 'left' ? -1 : 1) * pace(w.gait, frame)
      if (dx === 0) {
        return { ...w, x, frame } // ゆっくり歩きの、足を止める拍
      }
      const next = x + dx
      if (next < 0 || next > limit) {
        // S3: 位置はそのまま向きを反転し、残り距離を 1 減らす
        const left = w.left - 1
        return left > 0 ? { ...w, x, facing: turned(w.facing), left, frame } : arrive(x, turned(w.facing), random, frame)
      }
      const left = w.left - Math.abs(dx)
      return left > 0 ? { ...w, x: next, left, frame } : arrive(next, w.facing, random, frame) // S1・S2
    }
    case 'pause':
    case 'rest': {
      if (w.left <= 1) {
        // S5・S8: 端にいるなら内側へ、それ以外は半々で向きを決めて歩き出す（R4）
        const facing: Facing = x <= 0 ? 'right' : x >= limit ? 'left' : random() < 0.5 ? 'left' : 'right'
        return setOff(x, facing, random, frame)
      }
      if (w.mode === 'pause') {
        return { ...w, x, left: w.left - 1, frame } // S4: 何も変えない（R6）
      }
      // S7: 休んでいる間、ときどききょろきょろする（R5）
      const glance = random()
      const facing: Facing = glance < 0.05 ? 'left' : glance < 0.1 ? 'right' : glance < 0.13 ? 'front' : w.facing
      return { ...w, x, facing, left: w.left - 1, frame }
    }
  }
}
