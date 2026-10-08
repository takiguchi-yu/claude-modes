// マスコットが手に持つ道具。ツール名から道具を決め、その絵を持つ。
//
// 編集系のツールはハンマー、調べる系は虫めがね、新しく書くときは鉛筆、仲間を呼ぶときは旗、
// 待ちを始めるときは砂時計、テストを走らせる Bash はフラスコ。それ以外のツールでは道具を変えない。
// 使っている間は持ち続け、使い終えてから PROP_FRAMES コマでしまう（Grip）。
// 持ち替えてから SWAP_FRAMES コマは、別の道具を求められても今の道具を見せ続ける。
// 仕様は .scratch/props/spec.md（状態遷移表 S1〜S18）。描画も Claude Code の API も知らない。

export type PropId = 'hammer' | 'magnifier' | 'flag' | 'hourglass' | 'pencil' | 'flask'

/** 使い終えてから道具を持っているコマ数の既定（10 秒）。使っている間は数えない */
export const PROP_FRAMES = 100
/** 持ち替えてから、次の道具に持ち替えずに見せ続けるコマ数（1.5 秒。R23） */
export const SWAP_FRAMES = 15

/**
 * 1 体が手に持っている道具。`using` は使っている呼び出しの数（0 以上）、
 * `left` は使い終えてからの残りコマ数（1 以上）。
 * `using` が 1 以上なら「使用中」で `left` は減らず、0 なら「余韻」で 1 コマごとに減る。
 * `kind` は見せている道具、`held` はそれに持ち替えてからのコマ数（SWAP_FRAMES で止める）、
 * `next` は持ち替えを待っている道具（無ければ null）
 */
export type Grip = {
  readonly kind: PropId
  readonly using: number
  readonly left: number
  readonly held: number
  readonly next: PropId | null
}

/** 見せる道具だけを表す Grip の一部 */
type Shown = Pick<Grip, 'kind' | 'held' | 'next'>

/** 道具 `kind` を求められた（S13・S14・S16・S17）。持ち替えてから SWAP_FRAMES コマたつまでは、持ち替えを待つ */
function request(grip: Grip | null, kind: PropId): Shown {
  if (grip === null) return { kind, held: 0, next: null }
  if (kind === grip.kind) return { kind, held: grip.held, next: null }
  return grip.held >= SWAP_FRAMES ? { kind, held: 0, next: null } : { kind: grip.kind, held: grip.held, next: kind }
}

/** 呼び出しが始まった（S1・S5・S9）。その道具を求め、使っている数を 1 増やし、残りを `frames` にする */
export const grab = (grip: Grip | null, kind: PropId, frames = PROP_FRAMES): Grip => ({
  ...request(grip, kind),
  using: (grip?.using ?? 0) + 1,
  left: frames,
})

/** 呼び出しが終わった（S2・S6・S10）。その道具を求め、使っている数を 1 減らし（0 より下げない）、残りを `frames` にする */
export const relax = (grip: Grip | null, kind: PropId, frames = PROP_FRAMES): Grip => ({
  ...request(grip, kind),
  using: Math.max(0, (grip?.using ?? 0) - 1),
  left: frames,
})

/** 1 コマ進む（S3・S7・S11・S15・S18）。持ち替えを待っていれば時が来たら持ち替え、使っている間は残りを減らさず、余韻が尽きたらしまう */
export function decay(grip: Grip | null): Grip | null {
  if (grip === null) return null
  const held = Math.min(SWAP_FRAMES, grip.held + 1)
  const shown: Shown =
    grip.next !== null && held >= SWAP_FRAMES ? { kind: grip.next, held: 0, next: null } : { kind: grip.kind, held, next: grip.next }
  if (grip.using > 0) return { ...grip, ...shown }
  return grip.left > 1 ? { ...grip, ...shown, left: grip.left - 1 } : null
}

/** ツール名と道具の対応表（R1・R2・R17〜R19）。Bash はコマンドで決める（R20） */
const TOOL_PROPS: ReadonlyMap<string, PropId> = new Map<string, PropId>([
  ['Edit', 'hammer'],
  ['MultiEdit', 'hammer'],
  ['NotebookEdit', 'hammer'],
  ['Read', 'magnifier'],
  ['Grep', 'magnifier'],
  ['Glob', 'magnifier'],
  ['WebSearch', 'magnifier'],
  ['WebFetch', 'magnifier'],
  ['Agent', 'flag'],
  ['Monitor', 'hourglass'],
  ['ScheduleWakeup', 'hourglass'],
  ['Write', 'pencil'],
])

/** テストを実行するコマンドの名前。どの位置にあってもテストとみなす（R20） */
const TEST_RUNNERS: ReadonlySet<string> = new Set(['pytest', 'jest', 'vitest', 'mocha', 'rspec', 'phpunit', 'unittest', 'tox', 'nextest'])
/** 文字列・ファイル・ブランチの名前を扱うだけのコマンド。引数に test があってもテストではない（R20） */
const TEXT_COMMANDS: ReadonlySet<string> = new Set([
  'grep', 'rg', 'echo', 'printf', 'cat', 'ls', 'find', 'sed', 'awk', 'head', 'tail',
  'mkdir', 'rmdir', 'cd', 'pushd', 'rm', 'mv', 'cp', 'touch', 'ln', 'git',
])
/** 道具を入れる・外すだけの言葉。2 語目以降にあれば、テストの実行コマンドの名前があってもテストではない（R20） */
const INSTALL_WORDS: ReadonlySet<string> = new Set(['install', 'i', 'add', 'uninstall', 'remove', 'upgrade', 'require'])
/** 環境変数の設定（`CI=1`）。1 語目を決めるときに飛ばす（R20） */
const ASSIGNMENT = /^[A-Za-z_]\w*=/

/** heredoc（`<<'EOF'` から終わりの印まで）の本文。始まりの行の残りは残す。ヒアストリング `<<<` は除かない */
const HEREDOC = /(?<!<)<<(?!<)-?[ \t]*(['"]?)([A-Za-z_]\w*)\1([^\n]*)[\s\S]*?(?:\n[ \t]*\2[ \t]*(?=\n|$)|$)/g
/** 引用符で囲まれた中身。引用符の外の `\x` は先に読み飛ばす（`\'` を引用の始まりと取り違えず、閉じない `"` で遅くならない） */
const QUOTED = /\\[\s\S]|'[^']*'|"(?:[^"\\]|\\[\s\S])*"/g
/** 1 語目の前に置けるシェルの言葉。これを飛ばした語を 1 語目とみなす（`if test -f a` の test を数えない） */
const PREFIXES: ReadonlySet<string> = new Set(['if', 'elif', 'while', 'until', '!', 'then', 'do', 'else'])

/** 語がテストを実行するコマンドの名前か。パスとバージョンを外して見る（`vendor/bin/phpunit`・`jest@29`） */
const isRunner = (word: string): boolean => TEST_RUNNERS.has(word.split('/').pop()!.split('@')[0]!)

/**
 * コマンドがテストを走らせるか（R20）。heredoc の本文と、引用符で囲まれた中身（コミットメッセージなど）を
 * 除いてから、`&&`・`||`・`;`・`|`・`&`・括弧・改行で区切る。どれかの区切りが、テストを実行するコマンドの名前
 * （パス・バージョン付きでも）を含むか、2 語目以降に `test`・`test:` で始まる語・`--test` を含めばテストとみなす。
 * 文字列・ファイル・ブランチを扱うだけのコマンドで始まる区切りと、2 語目以降に道具を入れる言葉を含む区切りは数えない
 */
export function runsTests(command: string): boolean {
  const bare = command.replace(HEREDOC, '$3').replace(QUOTED, m => (m.startsWith('\\') ? m : '""'))
  return bare.split(/&&|\|\||[;|&()\n]/).some(segment => {
    const words = segment.trim().split(/\s+/).filter(word => word !== '')
    while (words.length > 0 && (PREFIXES.has(words[0]!) || ASSIGNMENT.test(words[0]!))) words.shift()
    if (words.length === 0 || TEXT_COMMANDS.has(words[0]!)) return false
    if (words.slice(1).some(word => INSTALL_WORDS.has(word))) return false
    return words.some((word, i) => isRunner(word) || (i > 0 && (/^test(:|$)/.test(word) || word === '--test')))
  })
}

/** ツール名（Bash ならコマンドも）に対応する道具。対応しなければ null（R1〜R3・R17〜R20） */
export function propFor(tool: string, command?: unknown): PropId | null {
  if (tool === 'Bash') return typeof command === 'string' && runsTests(command) ? 'flask' : null
  return TOOL_PROPS.get(tool) ?? null
}

// 道具の絵。右手に持つ向きで描き、高さはマスコットと同じ 6 ピクセル（R5・R22）。
// `#` は持ち主の色、英字は道具の色（PROP_COLORS）、`.` は空き
const ART: Readonly<Record<PropId, readonly string[]>> = {
  // 2026-10-07 にハンマーと虫めがねも色付きにした。ユーザーが見本からハンマー B（黒鉄・明るい木の柄）と
  // 虫めがね D（銀の縁・中は空き・木の柄）を選んだ
  hammer: ['HHHHH', 'HHHHH', '..J..', '..J..', '..J..', '.....'],
  magnifier: ['.MMM..', 'M...M.', 'M...M.', '.MMM..', '....K.', '.....K'],
  // 2026-10-07 に追加。1 色のドット絵では旗が「曲がった棒」、フラスコが「スコップ」に見え、記号 1 文字では小さすぎたので、
  // 色で形を補うドット絵にした。ユーザーが見本（旗 A・フラスコ B・鉛筆 A・砂時計 A）から選んだ
  flag: ['GRRRRR', 'GRRRRR', 'GRRRRR', 'G.....', 'G.....', 'G.....'],
  flask: ['..WW..', '..WW..', '.WWWW.', 'WLLLLW', 'WLLLLW', '.LLLL.'],
  pencil: ['PP', 'YY', 'YY', 'YY', 'TT', '.D'],
  hourglass: ['BBBBB', '.SSS.', '..S..', '..S..', '.SSS.', 'BBBBB'],
}

/** 道具の色（0xRRGGBB） */
const PROP_COLORS: Readonly<Record<string, number>> = {
  H: 0x5a606b, // ハンマーの黒鉄の頭
  J: 0xd6a86e, // ハンマーの明るい木の柄
  K: 0xa0703c, // 虫めがねの木の柄
  M: 0xc0c6cc, // 虫めがねの銀の縁
  G: 0x9a9a9a, // 旗の竿
  R: 0xe04f4f, // 旗の布
  W: 0xc8d0d8, // フラスコのガラス
  L: 0x5cd67a, // フラスコの液体
  P: 0xf08fa8, // 鉛筆の消しゴム
  Y: 0xf2c94c, // 鉛筆の軸
  T: 0xe8b98a, // 鉛筆の削った木
  D: 0x444444, // 鉛筆の芯
  B: 0xb08850, // 砂時計の枠
  S: 0xf2d27a, // 砂時計の砂
}

/** 道具を、絵の端の塗りから何ピクセル空けて描くか（R5） */
export const PROP_GAP = 1

/**
 * 道具が絵の端から張り出す幅（空ける分＋道具の幅）。持っていなければ 0。
 * 行列で前の 1 体との間に空ける分（.scratch/parade/spec.md の R4 の P）
 */
export const reach = (grip: Grip | null): number => (grip === null ? 0 : PROP_GAP + ART[grip.kind][0]!.length)

/** 道具の各ピクセルの色。持ち主の色で塗るところは `owner`、空きは null。左に持つときは左右反転する（R5・R22） */
export function propPixels(id: PropId, side: 'left' | 'right', owner: number): (number | null)[][] {
  const rows = ART[id].map(row => [...row].map(c => (c === '.' ? null : c === '#' ? owner : PROP_COLORS[c]!)))
  return side === 'left' ? rows.map(row => [...row].reverse()) : rows
}

/** 道具のどこが塗られているか。左に持つときは左右反転する（R5） */
export const propBitmap = (id: PropId, side: 'left' | 'right'): boolean[][] =>
  propPixels(id, side, 0).map(row => row.map(color => color !== null))
