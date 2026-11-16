import { expect, test } from 'claude-code/testing'
import type { Change, DiffFile, Hunk, Intention, ReviewFile, Slot } from '../../hooks/model'
import { pageData, pageLines, pageReview } from '../../hooks/page/data'

const hunk = (header: string, body: string[]): Hunk => {
  const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(header)!
  return { header, newStart: Number(m[1]), newLines: m[2] === undefined ? 1 : Number(m[2]), text: [header, ...body].join('\n') }
}
const diffFile = (path: string, hunks: Hunk[], extra: Partial<DiffFile> = {}): DiffFile => ({ path, status: 'modified', binary: false, hunks, ...extra })

const change = (hunkHeader: string, lines: [number, number], intention: number | null, explanation = 'x'): Change => ({
  hunk: hunkHeader,
  lines,
  intention,
  explanation,
  text: '',
})
const reviewFile = (path: string, changes: Change[], extra: Partial<ReviewFile> = {}): ReviewFile => ({
  path,
  role: 'a role',
  importance: 'normal',
  status: 'modified',
  changes,
  ...extra,
})
const intention = (id: number): Intention => ({ id, title: `T${id}`, why: `W${id}`, origin: 'conversation' })

function slot(files: ReviewFile[], intentions: Intention[] = [intention(1), intention(2)], skipped: string[] = []): Slot {
  return {
    root: '/r',
    name: 'r',
    start: 'abc',
    preexisting: [],
    resetStart: false,
    diffHash: 'h',
    review: { source: { kind: 'conversation', repo: '/r', ref: 'abc' }, diffHash: 'h', summary: 'sum', intentions, files, skipped, generatedAt: '2026-10-18T10:00:00.000Z' },
    status: 'idle',
    error: null,
    empty: false,
    gone: false,
    dormant: null,
    answers: [],
  }
}

test('pageLines numbers old and new lines from the header', () => {
  const h = hunk('@@ -10,3 +10,4 @@ fn', [' a', '+b', ' c', ' d'])
  expect(pageLines(h)).toEqual([
    { kind: 'context', old: 10, new: 10, text: 'a' },
    { kind: 'add', old: null, new: 11, text: 'b' },
    { kind: 'context', old: 11, new: 12, text: 'c' },
    { kind: 'context', old: 12, new: 13, text: 'd' },
  ])
})

test('pageLines: a deletion has no new number, and "no newline" is a meta line', () => {
  const h = hunk('@@ -5,2 +5 @@', ['-gone', ' kept', '\\ No newline at end of file'])
  expect(pageLines(h)).toEqual([
    { kind: 'del', old: 5, new: null, text: 'gone' },
    { kind: 'context', old: 6, new: 5, text: 'kept' },
    { kind: 'meta', old: null, new: null, text: '\\ No newline at end of file' },
  ])
})

test('pageLines: a header with no counts means one line', () => {
  expect(pageLines(hunk('@@ -3 +3 @@', ['-a', '+b'])).map(l => [l.old, l.new])).toEqual([[3, null], [null, 3]])
})

test('two 3-line changes land on the single 10-line hunk covering both, as two notes', () => {
  const wide = [diffFile('a.ts', [hunk('@@ -2,30 +2,30 @@', ['-x'])])]
  const h1 = '@@ -10,6 +10,6 @@'
  const h2 = '@@ -18,6 +18,6 @@'
  const page = pageReview(slot([reviewFile('a.ts', [change(h1, [12, 13], 1, 'one'), change(h2, [20, 21], 2, 'two')])]), wide, 'feat/x')
  const file = page.files[0]!
  expect(file.hunks).toHaveLength(1)
  expect(file.hunks[0]!.id).toBe('a.ts#0')
  expect(file.hunks[0]!.notes).toEqual([
    { intention: 1, explanation: 'one', lines: [12, 13], hunk: h1 },
    { intention: 2, explanation: 'two', lines: [20, 21], hunk: h2 },
  ])
})

test('a change goes to the first hunk it overlaps, ids count from 0 per file', () => {
  const wide = [diffFile('a.ts', [hunk('@@ -1,10 +1,10 @@', ['-x']), hunk('@@ -40,10 +40,10 @@', ['-y'])])]
  const page = pageReview(slot([reviewFile('a.ts', [change('h', [45, 46], 1)])]), wide, 'b')
  expect(page.files[0]!.hunks.map(h => [h.id, h.notes.length])).toEqual([['a.ts#0', 0], ['a.ts#1', 1]])
})

test('a change that overlaps no hunk is ignored', () => {
  const wide = [diffFile('a.ts', [hunk('@@ -1,10 +1,10 @@', ['-x'])])]
  const page = pageReview(slot([reviewFile('a.ts', [change('h', [100, 101], 1)])]), wide, 'b')
  expect(page.files[0]!.hunks[0]!.notes).toEqual([])
  expect(page.chapters.flatMap(c => c.hunks.length)).toEqual([0, 0, 1])
})

test('a pure-deletion hunk (0 new lines) takes the change that sits at its start', () => {
  const wide = [diffFile('a.ts', [hunk('@@ -4,2 +3,0 @@', ['-a', '-b'])])]
  const page = pageReview(slot([reviewFile('a.ts', [change('h', [3, 3], 1)])]), wide, 'b')
  expect(page.files[0]!.hunks[0]!.notes).toHaveLength(1)
})

test('a binary file of the review keeps no hunk and says so', () => {
  const wide = [diffFile('logo.png', [], { binary: true })]
  const page = pageReview(slot([reviewFile('logo.png', [])]), wide, 'b')
  expect(page.files).toEqual([{ path: 'logo.png', status: 'modified', importance: 'normal', role: 'a role', binary: true, hunks: [] }])
})

test('files: the review order first, then the diff files the review lacks; skipped files stay out', () => {
  const wide = [
    diffFile('z.ts', [hunk('@@ -1 +1 @@', ['-a', '+b'])]),
    diffFile('new.ts', [hunk('@@ -0,0 +1 @@', ['+a'])], { status: 'added' }),
    diffFile('pnpm-lock.yaml', [hunk('@@ -1 +1 @@', ['-a', '+b'])]),
    diffFile('img.png', [], { binary: true }),
    diffFile('a.ts', [hunk('@@ -1 +1 @@', ['-a', '+b'])]),
  ]
  const page = pageReview(slot([reviewFile('a.ts', []), reviewFile('z.ts', [])], [intention(1)], ['pnpm-lock.yaml', 'img.png']), wide, 'b')
  expect(page.files.map(f => f.path)).toEqual(['a.ts', 'z.ts', 'new.ts'])
  expect(page.files[2]!).toMatchObject({ status: 'added', importance: 'normal', role: '', binary: false })
  expect(page.skipped).toEqual(['pnpm-lock.yaml', 'img.png'])
})

test('a renamed file keeps its old path', () => {
  const wide = [diffFile('n.ts', [hunk('@@ -1 +1 @@', ['-a', '+b'])], { status: 'renamed', oldPath: 'o.ts' })]
  const page = pageReview(slot([], []), wide, 'b')
  expect(page.files[0]!).toMatchObject({ path: 'n.ts', oldPath: 'o.ts', status: 'renamed' })
})

test('chapters: one per intention in the review order; "other changes" only when a hunk has no intention', () => {
  const wide = [
    diffFile('a.ts', [hunk('@@ -1,5 +1,5 @@', ['-a']), hunk('@@ -50,5 +50,5 @@', ['-b'])]),
    diffFile('b.ts', [hunk('@@ -1,5 +1,5 @@', ['-c'])]),
  ]
  const changes = [change('h', [2, 3], 2), change('h', [51, 52], 1)]
  const page = pageReview(slot([reviewFile('a.ts', changes), reviewFile('b.ts', [change('h', [2, 2], 2)])]), wide, 'b')
  expect(page.chapters.map(c => [c.intention?.id, c.hunks])).toEqual([
    [1, ['a.ts#1']],
    [2, ['a.ts#0', 'b.ts#0']],
  ])
})

test('chapters: a hunk whose notes have no intention goes to the null chapter, last', () => {
  const wide = [diffFile('a.ts', [hunk('@@ -1,5 +1,5 @@', ['-a']), hunk('@@ -50,5 +50,5 @@', ['-b'])])]
  const page = pageReview(slot([reviewFile('a.ts', [change('h', [2, 3], 1), change('h', [51, 52], null)])]), wide, 'b')
  expect(page.chapters.map(c => [c.intention?.id ?? null, c.hunks])).toEqual([
    [1, ['a.ts#0']],
    [2, []],
    [null, ['a.ts#1']],
  ])
})

test('the page review carries the slot facts', () => {
  const s = slot([])
  s.status = 'failed'
  s.error = 'model'
  const page = pageReview(s, [], 'feat/x')
  expect(page).toMatchObject({ root: '/r', name: 'r', branch: 'feat/x', status: 'failed', error: 'model', summary: 'sum', files: [], chapters: [{ intention: { id: 1 }, hunks: [] }, { intention: { id: 2 }, hunks: [] }] })
})

test('a folder without a review has an empty page review', () => {
  const s = slot([])
  s.review = null
  const wide = [diffFile('a.ts', [hunk('@@ -1 +1 @@', ['-a', '+b'])])]
  const page = pageReview(s, wide, 'b')
  expect(page).toMatchObject({ summary: '', intentions: [], skipped: [], chapters: [{ intention: null, hunks: ['a.ts#0'] }] })
  expect(page.files.map(f => f.path)).toEqual(['a.ts'])
})

test('pageData: language, ISO date from the clock, publish state', () => {
  const data = pageData('en', [], Date.UTC(2026, 9, 18, 10, 0, 0), true, { '/r': 'https://x' })
  expect(data).toEqual({ lang: 'en', updatedAt: '2026-10-18T10:00:00.000Z', reviews: [], publish: true, published: { '/r': 'https://x' }, publishFailed: {}, sources: [] })
})
