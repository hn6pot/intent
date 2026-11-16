import { expect, test } from 'claude-code/testing'
import type { Review } from '../../hooks/model'
import { isKeptReview, prReviewKey, prunePrReviews } from '../../hooks/prs/stored'

const review = (generatedAt: string) => ({ generatedAt }) as Review

test('prReviewKey: pr:<slug>#<n>@<head>', () => {
  expect(prReviewKey({ slug: 'a/b', number: 7 }, 'h1')).toBe('pr:a/b#7@h1')
})

test('52 reviews: the 2 oldest go, whatever their order; other keys never', () => {
  const entries: [string, Review][] = Array.from({ length: 52 }, (_, i) => {
    const minute = String(51 - i).padStart(2, '0') // newest first
    return [`pr:a/b#${i}@h`, review(`2026-10-21T10:${minute}:00.000Z`)]
  })
  entries.push(['session:x', review('2000-01-01T00:00:00.000Z')])
  expect(prunePrReviews(entries).sort()).toEqual(['pr:a/b#50@h', 'pr:a/b#51@h'])
  expect(prunePrReviews(entries.slice(0, 50))).toEqual([])
  expect(prunePrReviews(entries, 51)).toEqual(['pr:a/b#51@h'])
})

test('isKeptReview: a review with its files, changes and intentions; anything else is not', () => {
  expect(isKeptReview({ intentions: [], files: [{ changes: [] }] })).toBe(true)
  for (const bad of [undefined, null, 'x', {}, { intentions: [], files: [null] }, { intentions: [], files: [{}] }, { files: [] }]) {
    expect(isKeptReview(bad)).toBe(false)
  }
})
