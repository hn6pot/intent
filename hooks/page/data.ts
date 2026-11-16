// Builds what the review page reads: the wide-context diff, each explanation attached to the page hunk holding its lines.
import type { Lang } from '../i18n'
import type {
  Change, DiffFile, Hunk, PageChapter, PageData, PageFile, PageHunk, PageLine, PagePr, PageReview, PageSource, ReviewFile, Slot,
} from '../model'
import { isSkipped } from '../review/skip'

const HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/
const KINDS: Record<string, PageLine['kind']> = { '+': 'add', '-': 'del', '\\': 'meta' }

/** The lines of a hunk, numbered from its "@@ -a,b +c,d @@" header; "\ No newline at end of file" is a meta line. */
export function pageLines(hunk: Hunk): PageLine[] {
  const [header = '', ...body] = hunk.text.split('\n')
  const match = HEADER.exec(header)
  let old = match ? Number(match[1]) : 1
  let next = match ? Number(match[2]) : 1
  return body.map(line => {
    const kind = KINDS[line.charAt(0)] ?? 'context'
    if (kind === 'meta') return { kind, old: null, new: null, text: line }
    const text = line.slice(1)
    if (kind === 'add') return { kind, old: null, new: next++, text }
    if (kind === 'del') return { kind, old: old++, new: null, text }
    return { kind, old: old++, new: next++, text }
  })
}

/** A pure deletion (0 new lines) still sits on its start line. */
export function covers(hunk: Pick<Hunk, 'newStart' | 'newLines'>, [from, to]: [number, number]): boolean {
  const last = Math.max(hunk.newStart, hunk.newStart + hunk.newLines - 1)
  return from <= last && to >= hunk.newStart
}

function pageFile(path: string, wide: DiffFile | undefined, meta: Pick<PageFile, 'status' | 'importance' | 'role'>, changes: Change[]): PageFile {
  const hunks: PageHunk[] = (wide?.hunks ?? []).map((hunk, n) => ({ id: `${path}#${n}`, header: hunk.header, lines: pageLines(hunk), notes: [] }))
  for (const change of changes) {
    const n = (wide?.hunks ?? []).findIndex(hunk => covers(hunk, change.lines))
    const target = hunks[n]
    if (target) target.notes.push({ intention: change.intention, explanation: change.explanation, lines: change.lines, hunk: change.hunk })
  }
  const file: PageFile = { path, status: meta.status, importance: meta.importance, role: meta.role, binary: wide?.binary ?? false, hunks }
  if (wide?.oldPath !== undefined) file.oldPath = wide.oldPath
  return file
}

function chaptersOf(files: PageFile[], review: Slot['review']): PageChapter[] {
  const hunks = files.flatMap(file => file.hunks)
  const intentions = review?.intentions ?? []
  const known = new Set(intentions.map(i => i.id))
  const chapters: PageChapter[] = intentions.map(intention => ({
    intention,
    hunks: hunks.filter(h => h.notes.some(note => note.intention === intention.id)).map(h => h.id),
  }))
  const others = hunks.filter(h => !h.notes.some(note => note.intention !== null && known.has(note.intention)))
  if (others.length > 0) chapters.push({ intention: null, hunks: others.map(h => h.id) })
  return chapters
}

/** `wide` is the diff with 10 lines of context; the review's explanations come from the 3-line one. */
export function pageReview(slot: Slot, wide: DiffFile[], branch: string, pr: PagePr | null = null): PageReview {
  const review = slot.review
  const byPath = new Map(wide.map(file => [file.path, file]))
  const skipped = new Set(review?.skipped ?? [])
  const reviewed = (review?.files ?? []).filter((file: ReviewFile) => !skipped.has(file.path))
  const known = new Set(reviewed.map(file => file.path))

  const files: PageFile[] = reviewed.map(file => pageFile(file.path, byPath.get(file.path), file, file.changes))
  for (const file of wide) {
    if (known.has(file.path) || skipped.has(file.path) || isSkipped(file)) continue
    files.push(pageFile(file.path, file, { status: file.status, importance: 'normal', role: '' }, []))
  }

  return {
    root: slot.root,
    name: slot.name,
    branch,
    pr,
    status: slot.status,
    error: slot.error,
    summary: review?.summary ?? '',
    intentions: review?.intentions ?? [],
    chapters: chaptersOf(files, review),
    files,
    skipped: review?.skipped ?? [],
    answers: [],
  }
}

export function pageData(
  lang: Lang, reviews: PageReview[], now: number, publish: boolean, published: Record<string, string>, publishFailed: Record<string, string> = {},
  sources: PageSource[] = [],
): PageData {
  return { lang, updatedAt: new Date(now).toISOString(), reviews, publish, published, publishFailed, sources }
}
