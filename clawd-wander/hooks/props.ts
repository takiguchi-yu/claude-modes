// マスコットが手に持つ道具。ツール名から道具を決め、その絵を持つ。
//
// 編集系のツールはハンマー、調べる系のツールは虫めがね。それ以外のツールでは道具を変えない。
// 仕様は .scratch/props/spec.md。描画も Claude Code の API も知らない。

export type PropId = 'hammer' | 'magnifier'

/** 道具を持っているコマ数（3 秒）。ツールの呼び出しが始まる・終わるたびに数え直す */
export const PROP_FRAMES = 30

const HAMMER_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const MAGNIFIER_TOOLS: ReadonlySet<string> = new Set(['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'])

/** ツール名に対応する道具。対応しなければ null（R1〜R3） */
export function propFor(tool: string): PropId | null {
  if (HAMMER_TOOLS.has(tool)) return 'hammer'
  if (MAGNIFIER_TOOLS.has(tool)) return 'magnifier'
  return null
}

// 道具の絵（# が塗り）。右手に持つ向きで描き、高さはマスコットと同じ 6 ピクセル
const ART: Record<PropId, readonly string[]> = {
  hammer: ['#####', '#####', '..#..', '..#..', '..#..', '.....'],
  magnifier: ['.###..', '#...#.', '#...#.', '.###..', '....#.', '.....#'],
}

/** 道具のビットマップ。左に持つときは左右反転する（R5） */
export function propBitmap(id: PropId, side: 'left' | 'right'): boolean[][] {
  const rows = ART[id].map(row => [...row].map(c => c === '#'))
  return side === 'left' ? rows.map(row => [...row].reverse()) : rows
}
