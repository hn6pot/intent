import { expect, test } from 'claude-code/testing'
import type { Answer, DiffFile, Review, Slot } from '../../hooks/model'
import { codeless, lacksCode, refill, restored, storable } from '../../hooks/review/stored'

const HUNK_A = '@@ -1,2 +1,3 @@ function a()'
const HUNK_B = '@@ -20 +21 @@'
const review = (text: string): Review => ({
  source: { kind: 'conversation', repo: '/r', ref: 'main' },
  diffHash: 'h1',
  summary: 's',
  intentions: [],
  files: [
    { path: 'src/a.ts', role: 'r', importance: 'key', status: 'modified', changes: [
      { hunk: HUNK_A, lines: [1, 3], intention: null, explanation: 'e', text },
      { hunk: HUNK_B, lines: [21, 21], intention: null, explanation: 'f', text },
    ] },
  ],
  skipped: [],
  generatedAt: '2026-10-17T10:00:00.000Z',
})
const slot = (overrides: Partial<Slot> = {}): Slot => ({
  root: '/r', name: 'r', start: 'main', preexisting: [], resetStart: false, diffHash: 'h1',
  review: review('CODE'), status: 'idle', error: null, empty: false, gone: false, dormant: null, answers: [], ...overrides,
})

test('storable: no hunk code, at most 500 preexisting paths, the slot it receives untouched', () => {
  const many = Array.from({ length: 600 }, (_, i) => `f${i}`)
  const before = slot({ preexisting: many })
  const saved = storable(before)
  expect(saved.review!.files[0]!.changes.map(c => c.text)).toEqual(['', ''])
  expect(saved.preexisting).toEqual(many.slice(0, 500))
  expect({ ...saved, review: null, preexisting: [] }).toEqual({ ...before, review: null, preexisting: [] })
  expect(before.review!.files[0]!.changes[0]!.text).toBe('CODE')
  expect(before.preexisting).toHaveLength(600)
})

test('storable: a finished answer keeps no excerpt; one waiting or running keeps it for its call', () => {
  const base = { key: 'k', kind: 'selection' as const, question: 'q', answer: '', error: null, at: '2026-10-19T10:00:00.000Z', excerpt: 'CODE' }
  const answers: Slot['answers'] = [
    { ...base, id: 'a-1', status: 'done', answer: 'R' },
    { ...base, id: 'a-2', status: 'failed', error: 'failed' },
    { ...base, id: 'a-3', status: 'running' },
    { ...base, id: 'a-4', status: 'waiting' },
  ]
  expect(storable(slot({ answers })).answers.map(a => a.excerpt)).toEqual([undefined, undefined, 'CODE', 'CODE'])
  expect(storable(slot({ answers })).answers[0]).not.toHaveProperty('excerpt')
})

test('storable: a slot without review stays as it is', () => {
  expect(storable(slot({ review: null }))).toEqual(slot({ review: null }))
})

const diffFile = (path: string, hunks: [string, string][]): DiffFile => ({
  path, status: 'modified', binary: false, hunks: hunks.map(([header, text]) => ({ header, newStart: 1, newLines: 1, text })),
})

test('refill: each empty text comes back from the hunk of the same file with the same header', () => {
  const files = [diffFile('src/b.ts', [[HUNK_A, 'WRONG FILE']]), diffFile('src/a.ts', [[HUNK_A, 'CODE A']])]
  const filled = refill(review(''), files)
  expect(filled.files[0]!.changes.map(c => c.text)).toEqual(['CODE A', '']) // HUNK_B is no longer in the diff
})

test('refill: the same review when there is nothing to fill', () => {
  const full = review('CODE')
  expect(refill(full, [diffFile('src/a.ts', [[HUNK_A, 'OTHER']])])).toBe(full)
  const empty = review('')
  expect(refill(empty, [diffFile('src/a.ts', [['@@ -9 +9 @@', 'X']])])).toBe(empty)
})

const answer = { id: 'a-1', key: 'k', kind: 'free' as const, question: 'q', answer: 'a', status: 'done' as const, error: null, at: '2026-10-19T10:00:00.000Z' }

test('storable: the answers are kept as they are', () => {
  const before = slot({ answers: [answer] })
  expect(storable(before).answers).toEqual([answer])
})

test('restored: a slot saved before the answers existed reads as having none', () => {
  const { answers: _, ...old } = slot()
  expect(restored(old as Slot).answers).toEqual([])
  expect(restored(slot({ answers: [answer] })).answers).toEqual([answer])
})

test('restored: an answer saved by the agent version loses its agent id; an error it no longer has reads as failed', () => {
  const old = (extra: object) => ({ ...answer, status: 'failed', answer: '', agentId: 'g1', ...extra }) as unknown as Answer
  const back = restored(slot({ answers: [old({ error: 'tooLong' }), old({ error: 'denied', reason: 'no' }), old({ error: 'interrupted' })] })).answers
  expect(back.map(a => [a.error, a.reason])).toEqual([['failed', undefined], ['failed', 'no'], ['interrupted', undefined]])
  expect(back[0]).not.toHaveProperty('agentId')
})

test('a PR slot keeps its pr through storable and restored', () => {
  const pr = { slug: 'a/b', number: 7, head: 'h1', clone: '/c', narrow: true }
  expect(storable(slot({ root: 'pr:a/b#7', pr })).pr).toEqual(pr)
  expect(restored(slot({ root: 'pr:a/b#7', pr })).pr).toEqual(pr)
  expect(restored(slot())).not.toHaveProperty('pr')
})

test('codeless: the review without its hunks code, the one it receives untouched', () => {
  const full = review('CODE')
  expect(codeless(full).files[0]!.changes.map(c => c.text)).toEqual(['', ''])
  expect(full.files[0]!.changes[0]!.text).toBe('CODE')
})

test('lacksCode: a review with one hunk without code, not a full one nor one without changes', () => {
  expect(lacksCode(review('CODE'))).toBe(false)
  expect(lacksCode(codeless(review('CODE')))).toBe(true)
  expect(lacksCode({ ...review('CODE'), files: [] })).toBe(false)
})
