import { expect, test } from 'claude-code/testing'
import { newAnswer, nextAnswerId, questionOf } from '../../hooks/agents/ask'
import { texts } from '../../hooks/i18n'
import type { Answer, Change, Review, Slot } from '../../hooks/model'
import { freeQuestion, hereKey, hereQuestion, questionKey, selectionKey, selectionQuestion } from '../../hooks/questions'
import { newSlot } from '../../hooks/review/slots'

const t = texts('fr')
const AT = '2026-10-19T10:00:00.000Z'
const change: Change = { hunk: '@@ -1,3 +1,4 @@', lines: [12, 18], intention: 1, explanation: 'valide la saisie', text: '+check' }
const review: Review = {
  source: { kind: 'conversation', repo: '/repo', ref: 'main' },
  diffHash: 'h1',
  summary: 'Résumé',
  intentions: [{ id: 1, title: 'Valider', why: 'Éviter les erreurs', origin: 'conversation' }],
  files: [{ path: 'a.ts', role: 'Rôle', importance: 'key', status: 'modified', changes: [change] }],
  skipped: [],
  generatedAt: AT,
}
const slot: Slot = { ...newSlot('/repo', { start: 'h0', preexisting: [] }), review }
const file = review.files[0]!

test('here: the change of the review, its question as displayed, its code as excerpt', () => {
  expect(newAnswer(t, slot, { kind: 'here', root: '/repo', path: 'a.ts', hunk: change.hunk }, 'a-1', AT)).toEqual({
    id: 'a-1', key: hereKey('/repo', 'a.ts', change.hunk), kind: 'here', path: 'a.ts', lines: [12, 18], excerpt: '+check',
    question: hereQuestion(t, '/repo', file, change), at: AT,
  })
})

test('here: a change the review no longer has, or no review at all, asks nothing', () => {
  expect(newAnswer(t, slot, { kind: 'here', root: '/repo', path: 'a.ts', hunk: '@@ -9 +9 @@' }, 'a-1', AT)).toBeNull()
  expect(newAnswer(t, { ...slot, review: null }, { kind: 'here', root: '/repo', path: 'a.ts', hunk: change.hunk }, 'a-1', AT)).toBeNull()
  expect(newAnswer(t, undefined, { kind: 'free', root: '/repo', text: 'pourquoi ?' }, 'a-1', AT)).toBeNull()
})

test('free: the trimmed text is the question and its key; a blank one asks nothing', () => {
  expect(newAnswer(t, slot, { kind: 'free', root: '/repo', text: '  pourquoi ? ' }, 'a-2', AT)).toEqual({
    id: 'a-2', key: questionKey('free', '/repo', 'pourquoi ?'), kind: 'free', question: 'pourquoi ?', at: AT,
  })
  expect(newAnswer(t, slot, { kind: 'free', root: '/repo', text: '   ' }, 'a-2', AT)).toBeNull()
})

test('selection: the chosen lines, their text cut to 4 000 characters', () => {
  const answer = newAnswer(t, slot, { kind: 'selection', root: '/repo', path: 'a.ts', from: 3, to: 5, text: 'x'.repeat(5000) }, 'a-3', AT)
  expect(answer).toEqual({
    id: 'a-3', key: selectionKey('/repo', 'a.ts', 3, 5), kind: 'selection', path: 'a.ts', lines: [3, 5], excerpt: 'x'.repeat(4000),
    question: selectionQuestion(t, '/repo', 'a.ts', 3, 5), at: AT,
  })
})

test('nextAnswerId: one past the highest id the slots hold, a-1 for none', () => {
  expect(nextAnswerId([slot])).toBe('a-1')
  const held = (id: string) => ({ id } as Answer)
  expect(nextAnswerId([{ ...slot, answers: [held('a-2'), held('a-9')] }, { ...slot, answers: [held('a-4'), held('odd')] }])).toBe('a-10')
})

test('questionOf: a here question carries the folder, the review summary and the intention of its change', () => {
  const answer = { ...newAnswer(t, slot, { kind: 'here', root: '/repo', path: 'a.ts', hunk: change.hunk }, 'a-1', AT)!, answer: '', status: 'waiting', error: null } as Answer
  expect(questionOf(t, slot, answer)).toEqual({
    repo: '/repo', path: 'a.ts', lines: [12, 18], excerpt: '+check', question: answer.question,
    summary: 'Résumé', intention: 'Valider: Éviter les erreurs',
  })
})

test('questionOf: a free question gets the review files in its text, every intention and every file with its role', () => {
  const free = { ...newAnswer(t, slot, { kind: 'free', root: '/repo', text: 'pourquoi ?' }, 'a-1', AT)!, answer: '', status: 'waiting', error: null } as Answer
  expect(questionOf(t, slot, free)).toEqual({
    repo: '/repo', question: freeQuestion(t, '/repo', review, 'pourquoi ?'), summary: 'Résumé',
    intentions: ['Valider: Éviter les erreurs'], files: ['a.ts: Rôle'],
  })
})

test('questionOf: a selection outside any change has no intention, one inside has its change\'s', () => {
  const outside = { id: 'a-1', key: 'k', kind: 'selection', path: 'a.ts', lines: [40, 42], excerpt: 'y', question: 'q', answer: '', status: 'waiting', error: null, at: AT } as Answer
  expect(questionOf(t, slot, outside)).not.toHaveProperty('intention')
  expect(questionOf(t, slot, outside)).not.toHaveProperty('intentions')
  const inside = { ...outside, lines: [17, 30] } as Answer
  expect(questionOf(t, slot, inside).intention).toBe('Valider: Éviter les erreurs')
})
