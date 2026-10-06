// 1 体の出入りの状態: いない → 現れかけ → いる → 消えかけ → いない。
//
// 現れかけは上から降りながらドットが埋まり、消えかけは浮き上がりながらドットが抜ける。
// 途中で向きが変わったときは、その時点の濃さのまま反転する（残りコマを FADE_FRAMES から引く）。
// 仕様は .scratch/fade-in/spec.md（状態遷移表 S1〜S12）。

/** 現れる・消えるのにかけるコマ数（10 コマ = 1 秒） */
export const FADE_FRAMES = 12
/** 何コマごとに 1 ピクセル浮くか */
const LIFT_EVERY = 3

export type Presence =
  | { readonly kind: 'gone' }
  | { readonly kind: 'arriving'; readonly left: number }
  | { readonly kind: 'here' }
  | { readonly kind: 'leaving'; readonly left: number }

export const GONE: Presence = { kind: 'gone' }
export const HERE: Presence = { kind: 'here' }

const arriving = (left: number): Presence => (left <= 0 ? HERE : { kind: 'arriving', left })
const leaving = (left: number): Presence => (left <= 0 ? GONE : { kind: 'leaving', left })

/** 出す（S1・S4・S7・S10） */
export function appear(p: Presence): Presence {
  switch (p.kind) {
    case 'gone':
      return arriving(FADE_FRAMES)
    case 'leaving':
      return arriving(FADE_FRAMES - p.left)
    case 'arriving':
    case 'here':
      return p
  }
}

/** 引っ込める（S2・S5・S8・S11） */
export function retreat(p: Presence): Presence {
  switch (p.kind) {
    case 'here':
      return leaving(FADE_FRAMES)
    case 'arriving':
      return leaving(FADE_FRAMES - p.left)
    case 'gone':
    case 'leaving':
      return p
  }
}

/** 1 コマ進む（S3・S6・S9・S12）。歩かせるかどうかは呼び出し側が決める */
export function elapse(p: Presence): Presence {
  switch (p.kind) {
    case 'arriving':
      return arriving(p.left - 1)
    case 'leaving':
      return leaving(p.left - 1)
    case 'gone':
    case 'here':
      return p
  }
}

/** 現れかけ・消えかけの見え方。濃さ（0〜1）と浮き（ピクセル）。いる・いないは null */
export function look(p: Presence): { opacity: number; lift: number } | null {
  switch (p.kind) {
    case 'arriving':
      return { opacity: 1 - p.left / FADE_FRAMES, lift: Math.ceil(p.left / LIFT_EVERY) }
    case 'leaving':
      return { opacity: p.left / FADE_FRAMES, lift: Math.floor((FADE_FRAMES - p.left) / LIFT_EVERY) }
    case 'gone':
    case 'here':
      return null
  }
}
