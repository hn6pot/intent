import { expect, test } from 'claude-code/testing'
import type { Review, Slot } from '../../hooks/model'
import { autoSelect } from '../../hooks/review/select'
import { newSlot } from '../../hooks/review/slots'

const REVIEW = { summary: 's', intentions: [], files: [], skipped: [] } as unknown as Review
const slot = (root: string, extra: Partial<Slot> = {}): Slot => ({ ...newSlot(root, { start: 'a', preexisting: [] }), ...extra })

const worktree = slot('/w/tree', { review: REVIEW })
const mainEmpty = slot('/w/main', { review: REVIEW, empty: true })

test('an empty folder woken first does not hide the one with a review', () => {
  expect(autoSelect([mainEmpty, worktree], '/w/main', false, '/w/tree')).toBe('/w/tree')
})

test('the session folder wins among folders with a review', () => {
  const other = slot('/w/other', { review: REVIEW })
  expect(autoSelect([other, worktree], null, false, '/w/tree')).toBe('/w/tree')
  expect(autoSelect([other, worktree], null, false, '/elsewhere')).toBe('/w/other')
})

test('a folder chosen by hand stays chosen, even empty', () => {
  expect(autoSelect([mainEmpty, worktree], '/w/main', true, '/w/tree')).toBe('/w/main')
})

test('a current folder with a review is kept', () => {
  const other = slot('/w/other', { review: REVIEW })
  expect(autoSelect([other, worktree], '/w/other', false, '/w/tree')).toBe('/w/other')
})

test('nothing reviewed yet: the session folder, else the first awake one; dormant and gone ones never', () => {
  const running = slot('/w/tree', { status: 'running' })
  const dormant = slot('/w/sleep', { dormant: 'hash' })
  const gone = slot('/w/gone', { review: REVIEW, gone: true })
  expect(autoSelect([dormant, gone, running], null, false, '/w/tree')).toBe('/w/tree')
  expect(autoSelect([dormant, gone, running], null, false, '/x')).toBe('/w/tree')
  expect(autoSelect([dormant, gone], null, false, '/x')).toBeNull()
})

test('a PR slot is never chosen on its own, only when chosen by hand', () => {
  const pr = slot('pr:a/b#7', { review: REVIEW, pr: { slug: 'a/b', number: 7, head: 'h1', clone: null, narrow: false } })
  expect(autoSelect([pr, mainEmpty], null, false, 'pr:a/b#7')).toBe('/w/main')
  expect(autoSelect([pr, worktree], 'pr:a/b#7', false, null)).toBe('/w/tree')
  expect(autoSelect([pr], 'pr:a/b#7', false, null)).toBeNull()
  expect(autoSelect([pr, worktree], 'pr:a/b#7', true, null)).toBe('pr:a/b#7')
})
