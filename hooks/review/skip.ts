// Decides which files stay out of the diff sent to the model, and which ones go in full or as headers only.
import type { DiffFile } from '../model'

const SKIPPED_NAMES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']
const SKIPPED_FOLDERS = ['dist', 'build']

/** Lock files, generated folders and binary files: their diff tells the model nothing useful. */
export function isSkipped(file: DiffFile): boolean {
  if (file.binary) return true
  const segments = file.path.split('/')
  const name = segments[segments.length - 1]
  if (name.endsWith('.lock') || SKIPPED_NAMES.includes(name)) return true
  return segments.slice(0, -1).some(folder => SKIPPED_FOLDERS.includes(folder))
}

/** Size of a file in the diff: the length of its hunks' text. */
function sizeOf(file: DiffFile): number {
  return file.hunks.reduce((sum, hunk) => sum + hunk.text.length, 0)
}

/**
 * Drops the skipped files, then sends the biggest files as headers only until the rest fits in `maxChars`.
 * Each list keeps the order of `files`.
 */
export function fitDiff(
  files: readonly DiffFile[],
  maxChars = 60_000,
): { full: DiffFile[]; headersOnly: DiffFile[]; skipped: string[] } {
  const kept: DiffFile[] = []
  const skipped: string[] = []
  for (const file of files) {
    if (isSkipped(file)) skipped.push(file.path)
    else kept.push(file)
  }

  let total = kept.reduce((sum, file) => sum + sizeOf(file), 0)
  const headers = new Set<DiffFile>()
  for (const file of [...kept].sort((a, b) => sizeOf(b) - sizeOf(a))) {
    if (total <= maxChars) break
    headers.add(file)
    total -= sizeOf(file)
  }

  return {
    full: kept.filter(file => !headers.has(file)),
    headersOnly: kept.filter(file => headers.has(file)),
    skipped,
  }
}
