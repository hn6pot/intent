// The PR reviews the store keeps across sessions: one per PR and head commit, 50 at most.
import type { PrRef, Review } from '../model'
import { prId } from './known'

const PR_PREFIX = 'pr:'

/** `pr:<slug>#<n>@<head>`: a review holds for one head commit. */
export const prReviewKey = (ref: PrRef, head: string): string => `${prId(ref)}@${head}`

/** The `pr:` keys past `max`, the oldest generated first; other keys are never returned. */
export function prunePrReviews(entries: readonly [string, Review][], max = 50): string[] {
  const kept = entries.filter(([key]) => key.startsWith(PR_PREFIX))
  if (kept.length <= max) return []
  const oldestFirst = [...kept].sort(([, a], [, b]) => a.generatedAt.localeCompare(b.generatedAt))
  return oldestFirst.slice(0, kept.length - max).map(([key]) => key)
}

/** A kept value that can be refilled: a review with its files and their changes (the store may hold anything). */
export function isKeptReview(value: unknown): value is Review {
  const files = (value as Review | undefined)?.files
  return Array.isArray(files) && files.every(file => Array.isArray(file?.changes)) && Array.isArray((value as Review).intentions)
}
