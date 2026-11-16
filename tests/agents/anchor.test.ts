import { expect, test } from 'claude-code/testing'
import type { Answer, PageFile, PageHunk, PageReview } from '../../hooks/model'
import { pageAnswers } from '../../hooks/agents/anchor'

const hunk = (header: string): PageHunk => ({ id: 'h', header, lines: [], notes: [] })
const file = (path: string, headers: string[]): PageFile => ({
  path, status: 'modified', importance: 'normal', role: '', binary: false, hunks: headers.map(hunk),
})
const review = (files: PageFile[]): PageReview => ({
  root: '/r', name: 'r', branch: 'main', pr: null, status: 'idle', error: null, summary: '', intentions: [], chapters: [], files, skipped: [], answers: [],
})
const answer = (extra: Partial<Answer>): Answer => ({
  id: 'a-1', key: 'k', kind: 'here', question: 'q', answer: 'a', status: 'done', error: null, at: '2026-10-19T10:00:00.000Z', ...extra,
})
const page = review([file('src/a.ts', ['@@ -10,3 +10,5 @@ fn', '@@ -40 +42,0 @@'])])

test('pageAnswers: lines covered by a hunk of the file: not moved', () => {
  expect(pageAnswers([answer({ path: 'src/a.ts', lines: [12, 13] })], page)[0]!.moved).toBe(false)
  expect(pageAnswers([answer({ path: 'src/a.ts', lines: [14, 30] })], page)[0]!.moved).toBe(false)
})

test('pageAnswers: lines outside every hunk: moved', () => {
  expect(pageAnswers([answer({ path: 'src/a.ts', lines: [20, 25] })], page)[0]!.moved).toBe(true)
})

test('pageAnswers: a pure deletion hunk still sits on its start line', () => {
  expect(pageAnswers([answer({ path: 'src/a.ts', lines: [42, 42] })], page)[0]!.moved).toBe(false)
  expect(pageAnswers([answer({ path: 'src/a.ts', lines: [43, 43] })], page)[0]!.moved).toBe(true)
})

test('pageAnswers: a hunk header without counts holds one line', () => {
  const one = review([file('b.ts', ['@@ -7 +7 @@'])])
  expect(pageAnswers([answer({ path: 'b.ts', lines: [7, 7] })], one)[0]!.moved).toBe(false)
  expect(pageAnswers([answer({ path: 'b.ts', lines: [8, 8] })], one)[0]!.moved).toBe(true)
})

test('pageAnswers: a file gone from the review: moved', () => {
  expect(pageAnswers([answer({ path: 'gone.ts', lines: [1, 2] })], page)[0]!.moved).toBe(true)
})

test('pageAnswers: a free question is never moved; no lines or no path is never moved', () => {
  expect(pageAnswers([answer({ kind: 'free' })], page)[0]!.moved).toBe(false)
  expect(pageAnswers([answer({ kind: 'free', path: 'gone.ts', lines: [1, 2] })], page)[0]!.moved).toBe(false)
  expect(pageAnswers([answer({ path: 'src/a.ts' })], page)[0]!.moved).toBe(false)
  expect(pageAnswers([answer({ lines: [1, 2] })], page)[0]!.moved).toBe(false)
})

test('pageAnswers: keeps only what the page needs, in order', () => {
  const out = pageAnswers([answer({ id: 'a-1', path: 'src/a.ts', lines: [10, 10], excerpt: 'secret code', key: 'k' }), answer({ id: 'a-2', kind: 'free' })], page)
  expect(out.map(a => a.id)).toEqual(['a-1', 'a-2'])
  expect(out[0]).toEqual({ id: 'a-1', kind: 'here', path: 'src/a.ts', lines: [10, 10], question: 'q', answer: 'a', status: 'done', error: null, at: '2026-10-19T10:00:00.000Z', moved: false })
  expect(out[1]).not.toHaveProperty('path')
  expect(out[1]).not.toHaveProperty('excerpt')
})

test('pageAnswers: a refusal reason reaches the page; none when there is none', () => {
  expect(pageAnswers([answer({ status: 'failed', error: 'failed', reason: 'no' })], page)[0]!.reason).toBe('no')
  expect(pageAnswers([answer({})], page)[0]!).not.toHaveProperty('reason')
})
