// The diff of a working folder since the starting point: committed, uncommitted and new files.
import type { Diff, Failure } from '../model'
import type { Host } from '../host'
import { parseDiff } from './parse-diff'

export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
/** New files diffed at most; the rest go to the review's skipped list. */
export const MAX_NEW_FILES = 50

/** FNV-1a, 32 bits, in hexadecimal: synchronous, enough to tell two diffs apart. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

// `core.quotepath=off` keeps non-ASCII names readable; `-z` keeps any name intact.
const GIT = ['git', '-c', 'core.quotepath=off'] as const
// Explicit prefixes: `diff.mnemonicPrefix` and `diff.noprefix` in the user's config would change the paths we read.
const PREFIXES = ['--src-prefix=a/', '--dst-prefix=b/'] as const

async function untracked(host: Host, root: string): Promise<string[] | null> {
  const r = await host.run([...GIT, '-C', root, 'ls-files', '-z', '--others', '--exclude-standard'])
  return r.exitCode === 0 ? r.stdout.split('\0').filter(name => name !== '') : null
}

/** The first change of a folder: where the review starts and which untracked files were already there. */
export async function firstChange(host: Host, root: string): Promise<{ start: string; preexisting: string[] }> {
  const head = await host.run(['git', '-C', root, 'rev-parse', 'HEAD'])
  const start = head.exitCode === 0 && head.stdout.trim() !== '' ? head.stdout.trim() : EMPTY_TREE
  return { start, preexisting: (await untracked(host, root)) ?? [] }
}

type Failed = { error: Extract<Failure, 'git' | 'truncated'> }

/** Reads `git diff <refs>` of a folder: the text, or a failure when git fails or the output comes cut. */
async function trackedDiff(host: Host, root: string, context: number, refs: readonly string[]): Promise<string | Failed> {
  const r = await host.run([...GIT, '-C', root, 'diff', '--no-color', '--no-ext-diff', '--find-renames', `-U${context}`, ...PREFIXES, ...refs])
  if (r.exitCode !== 0) return { error: 'git' }
  if (r.truncated) return { error: 'truncated' }
  return r.stdout
}

/** A diff from its text; the skipped files count in the hash, so one more past the cap is a change. */
export function diffOf(text: string, skipped: string[] = []): Diff {
  return { files: parseDiff(text), hash: hashText([text, ...skipped].join('\0')), chars: text.length, skipped }
}

/** The diff between two commits, with no untracked files; a failure when git fails or its diff comes cut. */
export async function rangeDiff(host: Host, root: string, from: string, to: string, context = 3): Promise<Diff | Failed> {
  const text = await trackedDiff(host, root, context, [from, to])
  return typeof text === 'string' ? diffOf(text) : text
}

/** A failure when git fails or its diff comes cut; whether the folder is gone is for the caller to tell. */
export async function computeDiff(
  host: Host,
  root: string,
  base: string,
  preexisting: readonly string[],
  context = 3,
): Promise<Diff | Failed> {
  const tracked = await trackedDiff(host, root, context, [base])
  if (typeof tracked !== 'string') return tracked
  const others = await untracked(host, root)
  if (others === null) return { error: 'git' }

  // A new file has no context lines, so the default keeps the exact command of step 1.
  const wide = context === 3 ? [] : [`-U${context}`]
  const known = new Set(preexisting)
  const added = others.filter(file => !known.has(file))
  const skipped = added.slice(MAX_NEW_FILES)
  const texts: string[] = []
  // One at a time: a folder full of new files must not start dozens of processes at once.
  for (const file of added.slice(0, MAX_NEW_FILES)) {
    const r = await host.run([...GIT, '-C', root, 'diff', '--no-color', '--no-index', ...wide, ...PREFIXES, '--', '/dev/null', file])
    // `--no-index` exits 1 when the files differ, which is what a new file always does; 2 or more, or a cut output: left out.
    if ((r.exitCode !== 0 && r.exitCode !== 1) || r.truncated) skipped.push(file)
    else texts.push(r.stdout)
  }

  return diffOf(tracked + texts.join(''), skipped)
}
