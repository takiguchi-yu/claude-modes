// マスコットの絵。どれも高さ 6 ピクセルで、足は最下行（入力欄の側）に置く。
//
// 本体は Clawd。サブエージェントには FRIENDS から 1 種類ずつ割り当てる。
// Clawd は目の位置で向きを表し、ほかは歩きの 2 コマを文字で描く（# が塗り）。
// 左右で形が違う絵は右向きに描いておき、左を向くときは反転する。

export type Facing = 'left' | 'front' | 'right'
export type Pose = 'stand' | 'stepA' | 'stepB'

export type MascotId = 'clawd' | 'ghost' | 'robot' | 'alien' | 'mushroom' | 'dino' | 'cat'

export type Mascot = {
  /** 幅（ピクセル） */
  readonly width: number
  /** 向きとポーズから、width × MASCOT_HEIGHT のビットマップを返す */
  readonly draw: (facing: Facing, pose: Pose) => boolean[][]
}

/** 絵の高さ（ピクセル） */
export const MASCOT_HEIGHT = 6

const parse = (rows: readonly string[]) => rows.map(row => [...row].map(c => c === '#'))
const mirror = (bitmap: boolean[][]) => bitmap.map(row => [...row].reverse())

/** 歩きの 2 コマから作る。stand は stepA と同じ絵 */
function walker(stepA: readonly string[], stepB: readonly string[], facesRight = false): Mascot {
  const frames = { stepA: parse(stepA), stepB: parse(stepB) }
  return {
    width: stepA[0]!.length,
    draw: (facing, pose) => {
      const bitmap = pose === 'stepB' ? frames.stepB : frames.stepA
      return facesRight && facing === 'left' ? mirror(bitmap) : bitmap
    },
  }
}

// ---- Clawd ------------------------------------------------------------------

// Claude Code の起動画面のロゴ（ ▐▛███▜▌ / ▝▜█████▛▘ /  ▘▘ ▝▝ ）をピクセルに起こしたもの。
// 絵は 5 ピクセルの高さなので、余る 1 行を上に置く。目と脚は向きとポーズで変わる。
const CLAWD_BODY = [
  '...############...',
  '...############...',
  '.################.',
  '...############...',
]

// 目の穴の x（胴体の 2 行目に開ける）。正面がロゴどおりの位置。
const CLAWD_EYES: Record<Facing, readonly [number, number]> = {
  left: [4, 11],
  front: [5, 12],
  right: [6, 13],
}

// 脚の x。stepB は stepA から 1 ピクセルずつ内外に入れ替えて足踏みに見せる。
const CLAWD_LEGS: Record<Pose, readonly number[]> = {
  stand: [4, 6, 11, 13],
  stepA: [4, 6, 11, 13],
  stepB: [5, 7, 10, 12],
}

const clawd: Mascot = {
  width: 18,
  draw: (facing, pose) => {
    const body = parse(CLAWD_BODY)
    const [leftEye, rightEye] = CLAWD_EYES[facing]
    body[1]![leftEye] = false
    body[1]![rightEye] = false
    const legs = Array.from({ length: 18 }, (_, x) => CLAWD_LEGS[pose].includes(x))
    const blank = Array.from({ length: 18 }, () => false)
    return [blank, ...body, legs]
  },
}

// ---- 仲間たち -----------------------------------------------------------------

const ghost = walker(
  ['..######..', '.########.', '.#..##..#.', '##########', '##########', '#.##..##.#'],
  ['..######..', '.########.', '.#..##..#.', '##########', '##########', '##.##.##.#'],
)

const robot = walker(
  ['....##....', '.########.', '.#.####.#.', '.########.', '..#....#..', '.##....##.'],
  ['....##....', '.########.', '.#.####.#.', '.########.', '...#..#...', '..##..##..'],
)

const alien = walker(
  ['..#......#..', '...######...', '..##.##.##..', '.##########.', '..#.#..#.#..', '.#..#..#..#.'],
  ['..#......#..', '...######...', '..##.##.##..', '.##########.', '.#..#..#..#.', '..#.#..#.#..'],
)

const mushroom = walker(
  ['...####...', '.##.##.##.', '##########', '..#.##.#..', '..######..', '..#....#..'],
  ['...####...', '.##.##.##.', '##########', '..#.##.#..', '..######..', '...#..#...'],
)

const dino = walker(
  ['.......####.', '.......#.###', '#......####.', '##..#####...', '.######.....', '..#..#......'],
  ['.......####.', '.......#.###', '#......####.', '##..#####...', '.######.....', '...#.#......'],
  true,
)

const cat = walker(
  ['........#..#', '#.......####', '#.......#.##', '.##########.', '.#########..', '.#.#...#.#..'],
  ['........#..#', '#.......####', '#.......#.##', '.##########.', '.#########..', '..#.#...#.#.'],
  true,
)

export const MASCOTS: Readonly<Record<MascotId, Mascot>> = { clawd, ghost, robot, alien, mushroom, dino, cat }

/** サブエージェントに割り当てる絵 */
export const FRIENDS: readonly MascotId[] = ['ghost', 'robot', 'alien', 'mushroom', 'dino', 'cat']

/** いちばん幅の広い絵（ピクセル）。帯がこれより狭ければ描かない */
export const WIDEST = Math.max(...Object.values(MASCOTS).map(m => m.width))
