// The answers to the review's questions: added, queued (3 model calls at a time), finished or failed. Pure functions over a list.
import type { Answer } from '../model'

/** Answers kept per review: past that, the oldest finished ones go first. */
export const MAX_ANSWERS = 50
/** Characters of an answer kept. */
export const MAX_ANSWER_CHARS = 4000
/** Questions answered at once in a session. */
export const MAX_RUNNING = 3

const isFinished = (a: Answer): boolean => a.status === 'done' || a.status === 'failed'

/**
 * A new answer waits for its turn; a question whose key is already waiting or running is not added again.
 * Past 50 the oldest finished one goes; a waiting or running one never does, so when none is finished the add is refused.
 */
export function addAnswer(list: readonly Answer[], a: Omit<Answer, 'status' | 'answer' | 'error'>): Answer[] {
  if (list.some(x => x.key === a.key && !isFinished(x))) return [...list]
  const next: Answer[] = [...list]
  if (next.length >= MAX_ANSWERS) {
    const finished = next.findIndex(isFinished)
    if (finished === -1) return next
    next.splice(finished, 1)
  }
  next.push({ ...a, answer: '', status: 'waiting', error: null })
  return next
}

/** The waiting answers to start, oldest first, so that at most `max` are running (`all`: every review's answers together). */
export function nextToStart(all: readonly Answer[], max = MAX_RUNNING): Answer[] {
  const free = max - all.filter(a => a.status === 'running').length
  return all.filter(a => a.status === 'waiting').slice(0, Math.max(0, free))
}

const change = (list: readonly Answer[], match: (a: Answer) => boolean, update: (a: Answer) => Answer): Answer[] =>
  list.map(a => (match(a) ? update(a) : a))

export function markRunning(list: readonly Answer[], id: string): Answer[] {
  return change(list, a => a.id === id, a => ({ ...a, status: 'running' }))
}

/** The model's reply, cut to 4 000 characters, and when it came; a finished or failed answer is not touched by a late reply. */
export function markDone(list: readonly Answer[], id: string, text: string, doneAt: string): Answer[] {
  return change(list, a => !isFinished(a) && a.id === id, a => ({ ...a, status: 'done', answer: text.slice(0, MAX_ANSWER_CHARS), error: null, doneAt }))
}

/** A finished or failed answer is not touched by a late failure; `reason` says why the model gave no answer. */
export function markFailed(list: readonly Answer[], id: string, error: NonNullable<Answer['error']>, reason?: string): Answer[] {
  return change(list, a => !isFinished(a) && a.id === id, a => ({ ...a, status: 'failed', error, ...(reason ? { reason } : {}) }))
}

/** On a resume nothing is still running: what was running or waiting is over. */
export function interruptRunning(list: readonly Answer[]): Answer[] {
  return change(list, a => a.status === 'running' || a.status === 'waiting', a => ({ ...a, status: 'failed', error: 'interrupted' }))
}
