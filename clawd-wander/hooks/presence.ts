// 1 体の出入りの状態: いない → 現れかけ → いる → 跳ねる → 消えかけ → いない。
//
// 現れかけは上から降りながらドットが埋まり、消えかけは浮き上がりながらドットが抜ける。
// いる者が引っ込められると、まずぴょんと跳ねてから消え始める（.scratch/emotes/spec.md R1）。
// 途中で向きが変わったときは、その時点の濃さのまま反転する（残りコマを FADE_FRAMES から引く）。
// 仕様は .scratch/fade-in/spec.md（状態遷移表 S1〜S12）と .scratch/emotes/spec.md（S8'・S13〜S15）。

/** 現れる・消えるのにかけるコマ数（10 コマ = 1 秒） */
export const FADE_FRAMES = 12
/** 何コマごとに 1 ピクセル浮くか */
const LIFT_EVERY = 3
/** 跳ねる間の浮き（残りコマ 4・3・2・1 の順） */
const LEAP_LIFTS = [1, 1, 1, 1] as const
export const LEAP_FRAMES = LEAP_LIFTS.length

export type Presence =
  | { readonly kind: 'gone' }
  | { readonly kind: 'arriving'; readonly left: number }
  | { readonly kind: 'here' }
  | { readonly kind: 'leaping'; readonly left: number }
  | { readonly kind: 'leaving'; readonly left: number }

export const GONE: Presence = { kind: 'gone' }
export const HERE: Presence = { kind: 'here' }

const arriving = (left: number): Presence => (left <= 0 ? HERE : { kind: 'arriving', left })
const leaving = (left: number): Presence => (left <= 0 ? GONE : { kind: 'leaving', left })

/** 出す（S1・S4・S7・S10・S13） */
export function appear(p: Presence): Presence {
  switch (p.kind) {
    case 'gone':
      return arriving(FADE_FRAMES)
    case 'leaving':
      return arriving(FADE_FRAMES - p.left)
    case 'leaping':
      return HERE
    case 'arriving':
    case 'here':
      return p
  }
}

/** 引っ込める（S2・S5・S8'・S11・S14） */
export function retreat(p: Presence): Presence {
  switch (p.kind) {
    case 'here':
      return { kind: 'leaping', left: LEAP_FRAMES }
    case 'arriving':
      return leaving(FADE_FRAMES - p.left)
    case 'gone':
    case 'leaping':
    case 'leaving':
      return p
  }
}

/** 1 コマ進む（S3・S6・S9・S12・S15）。歩かせるかどうかは呼び出し側が決める */
export function elapse(p: Presence): Presence {
  switch (p.kind) {
    case 'arriving':
      return arriving(p.left - 1)
    case 'leaping':
      return p.left <= 1 ? leaving(FADE_FRAMES) : { kind: 'leaping', left: p.left - 1 }
    case 'leaving':
      return leaving(p.left - 1)
    case 'gone':
    case 'here':
      return p
  }
}

/** 現れかけ・跳ねる・消えかけの見え方。濃さ（0〜1）と浮き（ピクセル）。いる・いないは null */
export function look(p: Presence): { opacity: number; lift: number } | null {
  switch (p.kind) {
    case 'arriving':
      return { opacity: 1 - p.left / FADE_FRAMES, lift: Math.ceil(p.left / LIFT_EVERY) }
    case 'leaving':
      return { opacity: p.left / FADE_FRAMES, lift: Math.floor((FADE_FRAMES - p.left) / LIFT_EVERY) }
    case 'leaping':
      return { opacity: 1, lift: LEAP_LIFTS[LEAP_FRAMES - p.left] ?? 0 }
    case 'gone':
    case 'here':
      return null
  }
}
