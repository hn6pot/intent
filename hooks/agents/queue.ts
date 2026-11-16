// The answers of every review together: which to start, a change applied to all, why an add was refused.
import type { Answer, Slot } from '../model'
import { nextToStart } from './answers'

/** The `n` of `a-<n>`: ids grow in the order the questions were asked in the session. */
export const answerNumber = (id: string): number => Number(/^a-(\d+)$/.exec(id)?.[1] ?? 0)

/** The waiting answers to start now (three at most in the session), in the order they were asked, each with its folder. */
export function toStart(slots: readonly Slot[]): { root: string; answer: Answer }[] {
  const rootOf = new Map(slots.flatMap(s => s.answers.map(a => [a.id, s.root] as const)))
  const all = slots.flatMap(s => s.answers).sort((a, b) => answerNumber(a.id) - answerNumber(b.id))
  return nextToStart(all).map(answer => ({ root: rootOf.get(answer.id) ?? '', answer }))
}

/** The same change to every review's answers (ids are unique in the session). */
export function mapAnswers(slots: readonly Slot[], change: (list: readonly Answer[]) => Answer[]): Slot[] {
  return slots.map(s => ({ ...s, answers: change(s.answers) }))
}

/** The keys of the answers a change made failed: their question may be asked again. */
export function failedKeys(before: readonly Slot[], after: readonly Slot[]): string[] {
  const was = new Map(before.flatMap(s => s.answers.map(a => [a.id, a.status] as const)))
  return after.flatMap(s => s.answers).filter(a => a.status === 'failed' && was.get(a.id) !== 'failed').map(a => a.key)
}

/** Why `addAnswer` left the list as it was: the same question under way, else 50 answers all unfinished. */
export function refusal(list: readonly Answer[], key: string): 'inFlight' | 'full' {
  return list.some(a => a.key === key && (a.status === 'waiting' || a.status === 'running')) ? 'inFlight' : 'full'
}
