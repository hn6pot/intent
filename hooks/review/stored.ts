// What the store keeps of a slot, within its 4 MiB, and how a restored review gets its code back.
import type { Answer, DiffFile, Review, Slot } from '../model'

/** Untracked files kept per slot: past that, a resumed session may count old ones as new. */
export const MAX_SAVED_PREEXISTING = 500

/** An answer as kept: once finished, without the lines sent to the model (no call will send them again). */
function storableAnswer(answer: Answer): Answer {
  if (answer.status !== 'done' && answer.status !== 'failed') return answer
  const { excerpt: _sent, ...kept } = answer
  return kept
}

/** The review without its hunks' code: the diff gives it back (`refill`). */
export function codeless(review: Review): Review {
  return { ...review, files: review.files.map(file => ({ ...file, changes: file.changes.map(change => ({ ...change, text: '' })) })) }
}

/** Whether a hunk of the review has no code: it was restored from the store and not refilled yet. */
export const lacksCode = (review: Review): boolean => review.files.some(file => file.changes.some(change => change.text === ''))

/** The slot without its hunks' code (the diff gives it back), its finished answers' excerpts, and with a bounded list of untracked files. */
export function storable(slot: Slot): Slot {
  const review = slot.review && codeless(slot.review)
  return { ...slot, review, preexisting: slot.preexisting.slice(0, MAX_SAVED_PREEXISTING), answers: slot.answers.map(storableAnswer) }
}

/** An answer saved by an older version: its agent's id dropped, an error it no longer has read as a plain failure. */
function restoredAnswer(saved: Answer & { agentId?: unknown }): Answer {
  const { agentId: _agent, ...answer } = saved
  return answer.error === null || answer.error === 'interrupted' || answer.error === 'failed' ? answer : { ...answer, error: 'failed' }
}

/** A slot read back from the store: one saved before the answers existed has none; a PR slot keeps its `pr`. */
export function restored(slot: Slot): Slot {
  return { ...slot, answers: (slot.answers ?? []).map(restoredAnswer) }
}

/** Each empty code back from the hunk of the same file with the same header; the same review when nothing comes back. */
export function refill(review: Review, files: readonly DiffFile[]): Review {
  let filled = false
  const reviewFiles = review.files.map(file => ({
    ...file,
    changes: file.changes.map(change => {
      if (change.text !== '') return change
      const hunk = files.find(f => f.path === file.path)?.hunks.find(h => h.header === change.hunk)
      if (!hunk) return change
      filled = true
      return { ...change, text: hunk.text }
    }),
  }))
  return filled ? { ...review, files: reviewFiles } : review
}
