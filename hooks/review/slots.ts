// Per-folder review state: what the pane keeps for one working folder, and the end-of-turn decision.
import type { Diff, Failure, KnownPr, Review, Slot } from '../model'
import { fitDiff } from './skip'

const SESSION_PREFIX = 'session:'
const MONTH_MS = 30 * 24 * 3600 * 1000

/** What the store keeps for one session; `prs` is absent from a session saved before the PRs existed. */
export type Saved = { updatedAt: number; slots: Slot[]; prs?: KnownPr[] }

export type SlotEvent =
  | { kind: 'running' }
  | { kind: 'done'; review: Review }
  | { kind: 'failed'; error: Failure }
  | { kind: 'stale' }
  | { kind: 'empty' }
  | { kind: 'gone' }
  | { kind: 'reset-start'; start: string }
  /** On a feature branch the start does not move: the reset is only dropped. */
  | { kind: 'keep-start' }
  | { kind: 'wake' }
  | { kind: 'refill'; review: Review }

/** The displayed name of a folder: its last path segment, a trailing slash ignored. */
function nameOf(root: string): string {
  const segments = root.replace(/\/+$/, '').split('/')
  return segments[segments.length - 1]
}

/** A folder only read so far (a `cd`, a `git -C`, the session's own): hidden, no review, until its diff changes or a file is written in it. */
export const isDormant = (slot: Slot): boolean => typeof slot.dormant === 'string'

/** A working folder, not a reviewed PR. */
export const isFolder = (slot: Slot): boolean => slot.pr === undefined

/** A press on a PR or a folder starts its review when it has none to show (or none is under way), or when it is behind. */
export function needsReview(slots: readonly Slot[], root: string): boolean {
  const slot = slots.find(s => s.root === root)
  if (slot === undefined) return true
  if (slot.status === 'running') return false
  return slot.status === 'stale' || slot.status === 'failed' || (slot.review === null && !slot.empty)
}

/** `dormant`: the diff hash of a folder only read, else null. */
export function newSlot(root: string, first: { start: string; preexisting: string[] }, dormant: string | null = null): Slot {
  return {
    root,
    name: nameOf(root),
    start: first.start,
    preexisting: first.preexisting,
    resetStart: false,
    diffHash: null,
    review: null,
    status: 'idle',
    error: null,
    empty: false,
    gone: false,
    dormant,
    answers: [],
  }
}

/** What the end of a turn must do for this folder. The first matching rule wins. */
export function decide(slot: Slot, diff: Diff, paneOpen: boolean): 'generate' | 'stale' | 'empty' | 'nothing' {
  const { full, headersOnly } = fitDiff(diff.files)
  if (full.length === 0 && headersOnly.length === 0) return 'empty'
  if (diff.hash === slot.diffHash && slot.status !== 'failed') return 'nothing'
  if (!paneOpen) return 'stale'
  return 'generate'
}

export function apply(slot: Slot, event: SlotEvent): Slot {
  switch (event.kind) {
    case 'running':
      return { ...slot, status: 'running' }
    case 'done':
      return { ...slot, review: event.review, diffHash: event.review.diffHash, status: 'idle', error: null, empty: false }
    case 'failed':
      return { ...slot, status: 'failed', error: event.error }
    case 'stale':
      return { ...slot, status: 'stale' }
    case 'empty':
      return { ...slot, empty: true, status: 'idle', diffHash: null }
    case 'gone':
      return { ...slot, gone: true }
    case 'reset-start':
      return { ...slot, start: event.start, resetStart: false }
    case 'keep-start':
      return { ...slot, resetStart: false }
    case 'wake':
      return { ...slot, dormant: null }
    case 'refill':
      return { ...slot, review: event.review }
  }
}

/** Keys of the sessions untouched for more than 30 days. Other keys are never returned. */
export function pruneSessions(entries: readonly [string, Saved][], now: number): string[] {
  return entries
    .filter(([key, saved]) => key.startsWith(SESSION_PREFIX) && now - saved.updatedAt > MONTH_MS)
    .map(([key]) => key)
}

/** The session key updated longest ago, other than `current`: the first to go when the store is full. */
export function oldestSession(entries: readonly [string, Saved][], current: string): string | null {
  const others = entries.filter(([key]) => key.startsWith(SESSION_PREFIX) && key !== current)
  others.sort(([, a], [, b]) => a.updatedAt - b.updatedAt)
  return others[0]?.[0] ?? null
}
