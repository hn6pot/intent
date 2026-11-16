// A question pressed on the page: the answer it adds to its folder's slot, and the question the model gets.
import type { Texts } from '../i18n'
import type { Answer, Intention, Review, Slot } from '../model'
import { freeQuestion, hereKey, hereQuestion, questionKey, selectionKey, selectionQuestion } from '../questions'
import type { Question } from './brief'
import { answerNumber } from './queue'

const EXCERPT_LIMIT = 4000

export type Ask =
  | { kind: 'here'; root: string; path: string; hunk: string }
  | { kind: 'free'; root: string; text: string }
  | { kind: 'selection'; root: string; path: string; from: number; to: number; text: string }

export type NewAnswer = Omit<Answer, 'status' | 'answer' | 'error'>

/** The next `a-<n>`, one past the highest the slots hold (a resumed session's included). */
export function nextAnswerId(slots: readonly Slot[]): string {
  return `a-${Math.max(0, ...slots.flatMap(s => s.answers).map(a => answerNumber(a.id))) + 1}`
}

/** A selection in a file its folder's review does not have: refused, with a toast. */
export const isUnknownFile = (slot: Slot | undefined, ask: Ask): boolean =>
  ask.kind === 'selection' && !!slot?.review && !slot.review.files.some(f => f.path === ask.path)

/** The answer a question adds; null when there is nothing to ask about: no review, a change or a file it does not have, a blank question. */
export function newAnswer(t: Texts, slot: Slot | undefined, ask: Ask, id: string, at: string): NewAnswer | null {
  const review = slot?.review
  if (!slot || !review) return null
  if (ask.kind === 'here') {
    const file = review.files.find(f => f.path === ask.path)
    const change = file?.changes.find(c => c.hunk === ask.hunk)
    if (!file || !change) return null
    return {
      id, key: hereKey(slot.root, ask.path, ask.hunk), kind: 'here', path: ask.path, lines: change.lines,
      excerpt: change.text.slice(0, EXCERPT_LIMIT), question: hereQuestion(t, slot.root, file, change), at,
    }
  }
  if (ask.kind === 'selection') {
    if (isUnknownFile(slot, ask)) return null
    return {
      id, key: selectionKey(slot.root, ask.path, ask.from, ask.to), kind: 'selection', path: ask.path, lines: [ask.from, ask.to],
      excerpt: ask.text.slice(0, EXCERPT_LIMIT), question: selectionQuestion(t, slot.root, ask.path, ask.from, ask.to), at,
    }
  }
  const text = ask.text.trim()
  return text === '' ? null : { id, key: questionKey('free', slot.root, text), kind: 'free', question: text, at }
}

/** The intention of the change whose lines meet the answer's, in that file. */
function intentionOf(review: Review, answer: Answer): Intention | undefined {
  const lines = answer.lines
  if (answer.path === undefined || lines === undefined) return undefined
  const change = review.files.find(f => f.path === answer.path)?.changes.find(c => c.lines[0] <= lines[1] && lines[0] <= c.lines[1])
  return review.intentions.find(i => i.id === change?.intention)
}

/**
 * What the model is told: the displayed question (a free one with the review's files), the lines, the review's summary and
 * the intention of the change; for a free question, every intention and every file with its role.
 */
export function questionOf(t: Texts, slot: Slot, answer: Answer): Question {
  const review = slot.review
  const question = answer.kind === 'free' && review ? freeQuestion(t, slot.root, review, answer.question) : answer.question
  const q: Question = { repo: slot.root, question }
  if (answer.path !== undefined) q.path = answer.path
  if (answer.lines !== undefined) q.lines = answer.lines
  if (answer.excerpt !== undefined) q.excerpt = answer.excerpt
  if (!review) return q
  q.summary = review.summary
  if (answer.kind === 'free') {
    q.intentions = review.intentions.map(i => `${i.title}: ${i.why}`)
    q.files = review.files.map(f => `${f.path}: ${f.role}`)
    return q
  }
  const intention = intentionOf(review, answer)
  if (intention) q.intention = `${intention.title}: ${intention.why}`
  return q
}
