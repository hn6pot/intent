import { expect, test } from 'claude-code/testing'
import type { Diff, DiffFile, Review, Slot } from '../../hooks/model'
import { apply, decide, isDormant, needsReview, newSlot, oldestSession, pruneSessions, type Saved } from '../../hooks/review/slots'

const file = (path: string): DiffFile => ({
  path,
  status: 'modified',
  binary: false,
  hunks: [{ header: '@@ -1 +1 @@', newStart: 1, newLines: 1, text: 'x' }],
})

const diffOf = (hash: string, files: DiffFile[] = [file('src/a.ts')]): Diff => ({ files, hash, chars: 1, skipped: [] })

const slot = (overrides: Partial<Slot> = {}): Slot => ({
  root: '/work/app',
  name: 'app',
  start: 'main',
  preexisting: [],
  resetStart: false,
  diffHash: null,
  review: null,
  status: 'idle',
  error: null,
  empty: false,
  gone: false,
  dormant: null,
  answers: [],
  ...overrides,
})

const review = (diffHash: string): Review => ({
  source: { kind: 'conversation', repo: 'app', ref: 'main' },
  diffHash,
  summary: 'summary',
  intentions: [],
  files: [],
  skipped: [],
  generatedAt: '2026-10-17T10:00:00.000Z',
})

const DAY = 24 * 3600 * 1000

test('newSlot names the slot after the last segment of root and starts empty', () => {
  expect(newSlot('/work/app', { start: 'main', preexisting: ['notes.md'] })).toEqual({
    root: '/work/app',
    name: 'app',
    start: 'main',
    preexisting: ['notes.md'],
    resetStart: false,
    diffHash: null,
    review: null,
    status: 'idle',
    error: null,
    empty: false,
    gone: false,
    dormant: null,
    answers: [],
  })
})

test('newSlot for a folder only read: dormant, holding the diff hash of its first touch', () => {
  const sleeping = newSlot('/work/app', { start: 'main', preexisting: [] }, 'h0')
  expect(sleeping.dormant).toBe('h0')
  expect(isDormant(sleeping)).toBe(true)
})

test('apply wake makes a dormant slot a normal one', () => {
  const woken = apply(slot({ dormant: 'h0' }), { kind: 'wake' })
  expect(woken.dormant).toBeNull()
  expect(isDormant(woken)).toBe(false)
})

test('a slot saved before dormant slots existed is awake', () => {
  const { dormant: _, ...old } = slot()
  expect(isDormant(old as Slot)).toBe(false)
})

test('newSlot starts without answers', () => {
  expect(newSlot('/work/app', { start: 'main', preexisting: [] }).answers).toEqual([])
})

test('newSlot ignores a trailing slash when naming the slot', () => {
  expect(newSlot('/work/app/', { start: 'main', preexisting: [] }).name).toBe('app')
})

test('decide returns empty when only skipped files changed', () => {
  const lockOnly = diffOf('h1', [file('package-lock.json'), file('dist/bundle.js')])
  expect(decide(slot(), lockOnly, true)).toBe('empty')
})

test('decide returns empty when the diff has no file at all', () => {
  expect(decide(slot(), diffOf('h1', []), true)).toBe('empty')
})

test('decide returns empty, never generate, for an empty diff with a new fingerprint', () => {
  expect(decide(slot({ diffHash: 'old' }), diffOf('h1', []), true)).toBe('empty')
})

test('decide returns nothing when the fingerprint is unchanged and the last run did not fail', () => {
  expect(decide(slot({ diffHash: 'h1' }), diffOf('h1'), true)).toBe('nothing')
})

test('decide returns generate after a failure with the same fingerprint, so retry and next turn rerun it', () => {
  expect(decide(slot({ diffHash: 'h1', status: 'failed' }), diffOf('h1'), true)).toBe('generate')
})

test('decide returns stale when the pane is closed and the fingerprint is unchanged after a failure', () => {
  expect(decide(slot({ diffHash: 'h1', status: 'failed' }), diffOf('h1'), false)).toBe('stale')
})

test('decide returns stale when the pane is closed and the diff changed', () => {
  expect(decide(slot({ diffHash: 'old' }), diffOf('h1'), false)).toBe('stale')
})

test('decide returns generate when the diff changed and the pane is open', () => {
  expect(decide(slot({ diffHash: 'old' }), diffOf('h1'), true)).toBe('generate')
})

test('apply running marks the slot as running and changes nothing else', () => {
  const before = slot({ diffHash: 'h0' })
  expect(apply(before, { kind: 'running' })).toEqual({ ...before, status: 'running' })
})

test('apply done keeps the review, takes its fingerprint and clears the error and the empty flag', () => {
  const before = slot({ status: 'running', error: 'git', empty: true })
  const result = apply(before, { kind: 'done', review: review('h2') })
  expect(result.review).toEqual(review('h2'))
  expect(result.diffHash).toBe('h2')
  expect(result.status).toBe('idle')
  expect(result.error).toBe(null)
  expect(result.empty).toBe(false)
})

test('apply failed keeps the previous review and records the error', () => {
  const previous = review('h1')
  const result = apply(slot({ review: previous, diffHash: 'h1', status: 'running' }), { kind: 'failed', error: 'model' })
  expect(result.status).toBe('failed')
  expect(result.error).toBe('model')
  expect(result.review).toEqual(previous)
  expect(result.diffHash).toBe('h1')
})

test('apply done after failed clears the error', () => {
  const failed = apply(slot(), { kind: 'failed', error: 'model' })
  expect(apply(failed, { kind: 'done', review: review('h3') }).error).toBe(null)
})

test('apply stale marks the slot as stale', () => {
  expect(apply(slot(), { kind: 'stale' }).status).toBe('stale')
})

test('apply empty flags the slot as empty, idle, with no fingerprint', () => {
  const result = apply(slot({ diffHash: 'h1', status: 'running' }), { kind: 'empty' })
  expect(result.empty).toBe(true)
  expect(result.status).toBe('idle')
  expect(result.diffHash).toBe(null)
})

test('apply gone freezes the slot and changes nothing else', () => {
  const before = slot({ diffHash: 'h1', review: review('h1') })
  expect(apply(before, { kind: 'gone' })).toEqual({ ...before, gone: true })
})

test('apply reset-start sets the new start and clears the reset flag', () => {
  const result = apply(slot({ resetStart: true, start: 'main' }), { kind: 'reset-start', start: 'origin/main' })
  expect(result.start).toBe('origin/main')
  expect(result.resetStart).toBe(false)
})

test('apply does not mutate the slot it receives', () => {
  const before = slot({ status: 'idle' })
  apply(before, { kind: 'failed', error: 'model' })
  expect(before.status).toBe('idle')
  expect(before.error).toBe(null)
})

test('pruneSessions deletes a session untouched for 31 days and keeps one of 29 days', () => {
  const now = 1_000 * DAY
  const saved = (updatedAt: number): Saved => ({ updatedAt, slots: [] })
  const entries: [string, Saved][] = [
    ['session:old', saved(now - 31 * DAY)],
    ['session:recent', saved(now - 29 * DAY)],
  ]
  expect(pruneSessions(entries, now)).toEqual(['session:old'])
})

test('pruneSessions keeps a session of exactly 30 days', () => {
  const now = 1_000 * DAY
  expect(pruneSessions([['session:edge', { updatedAt: now - 30 * DAY, slots: [] }]], now)).toEqual([])
})

test('pruneSessions ignores keys without the session: prefix', () => {
  const now = 1_000 * DAY
  const ancient = { updatedAt: now - 365 * DAY, slots: [] }
  expect(pruneSessions([['sessions:old', ancient], ['config', ancient]], now)).toEqual([])
})

test('oldestSession: the session key updated longest ago, never the current one nor another kind of key', () => {
  const saved = (updatedAt: number): Saved => ({ updatedAt, slots: [] })
  const entries: [string, Saved][] = [['session:me', saved(1)], ['session:b', saved(20)], ['config', saved(0)], ['session:a', saved(10)]]
  expect(oldestSession(entries, 'session:me')).toBe('session:a')
  expect(oldestSession([['session:me', saved(1)]], 'session:me')).toBeNull()
})

test('apply refill swaps the review and nothing else', () => {
  const before = slot({ status: 'failed', error: 'model', diffHash: 'h1', review: review('h1') })
  const filled = { ...review('h1'), summary: 'filled' }
  expect(apply(before, { kind: 'refill', review: filled })).toEqual({ ...before, review: filled })
})

test('apply keep-start drops the reset and keeps the start', () => {
  expect(apply(slot({ resetStart: true, start: 'main' }), { kind: 'keep-start' })).toEqual(slot({ resetStart: false, start: 'main' }))
})

test('needs a review: no slot, no review, or behind; not while it runs or once up to date', () => {
  const REVIEW = review('h')
  expect(needsReview([], 'pr:a/b#1')).toBe(true)
  expect(needsReview([slot()], '/work/app')).toBe(true)
  expect(needsReview([slot({ review: REVIEW })], '/work/app')).toBe(false)
  expect(needsReview([slot({ review: REVIEW, status: 'stale' })], '/work/app')).toBe(true)
  expect(needsReview([slot({ review: REVIEW, status: 'failed' })], '/work/app')).toBe(true)
  expect(needsReview([slot({ status: 'running' })], '/work/app')).toBe(false)
  expect(needsReview([slot({ review: REVIEW, empty: true })], '/work/app')).toBe(false)
})
