import { expect, test } from 'claude-code/testing'
import { isWatched, viewerUntil } from '../../hooks/server/viewer'

test('a page signal counts for 25 s', () => {
  expect(viewerUntil(1_000)).toBe(26_000)
})

test('watched: the pane open, or the page signalled within its window', () => {
  expect(isWatched(false, 0, 0)).toBe(true)
  expect(isWatched(true, 25_999, 26_000)).toBe(true)
  expect(isWatched(true, 26_000, 26_000)).toBe(false)
  expect(isWatched(true, 5_000, 0)).toBe(false)
})
