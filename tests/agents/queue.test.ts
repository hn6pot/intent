import { expect, test } from 'claude-code/testing'
import { failedKeys, mapAnswers, refusal, toStart } from '../../hooks/agents/queue'
import type { Answer, Slot } from '../../hooks/model'
import { newSlot } from '../../hooks/review/slots'

const answer = (n: number, status: Answer['status'], extra: Partial<Answer> = {}): Answer => ({
  id: `a-${n}`, key: `k${n}`, kind: 'free', question: `q${n}`, answer: '', status, error: null, at: '2026-10-19T10:00:00.000Z', ...extra,
})
const slot = (root: string, answers: Answer[]): Slot => ({ ...newSlot(root, { start: 'h0', preexisting: [] }), answers })

test('toStart: the oldest waiting answers of every review, three at most in all, with their folder', () => {
  const slots = [slot('/a', [answer(1, 'running'), answer(2, 'waiting')]), slot('/b', [answer(3, 'running'), answer(4, 'waiting')])]
  expect(toStart(slots)).toEqual([{ root: '/a', answer: answer(2, 'waiting') }])
  expect(toStart([slot('/a', [answer(1, 'waiting')]), slot('/b', [answer(2, 'waiting')])]).map(s => s.root)).toEqual(['/a', '/b'])
})

test('toStart: in the order the questions were asked, whatever their folder (a-4 in /b before a-5 in /a, a-10 after a-9)', () => {
  const slots = [slot('/a', [answer(1, 'running'), answer(5, 'waiting'), answer(10, 'waiting')]), slot('/b', [answer(2, 'running'), answer(4, 'waiting'), answer(9, 'waiting')])]
  expect(toStart(slots)).toEqual([{ root: '/b', answer: answer(4, 'waiting') }])
  const free = [slot('/a', [answer(5, 'waiting'), answer(10, 'waiting')]), slot('/b', [answer(4, 'waiting'), answer(9, 'waiting')])]
  expect(toStart(free).map(s => s.answer.id)).toEqual(['a-4', 'a-5', 'a-9'])
})

test('mapAnswers: the change goes to every review, the rest of the slot stays', () => {
  const slots = [slot('/a', [answer(1, 'waiting')]), slot('/b', [answer(2, 'waiting')])]
  const changed = mapAnswers(slots, list => list.map(a => ({ ...a, status: 'running' as const })))
  expect(changed.map(s => s.answers.map(a => a.status))).toEqual([['running'], ['running']])
  expect(changed[1]!.root).toBe('/b')
  expect(slots[0]!.answers[0]!.status).toBe('waiting')
})

test('failedKeys: the keys of the answers a change made failed, and only those', () => {
  const before = [slot('/a', [answer(1, 'running'), answer(2, 'failed'), answer(3, 'waiting')])]
  const after = [slot('/a', [answer(1, 'failed'), answer(2, 'failed'), answer(3, 'running')])]
  expect(failedKeys(before, after)).toEqual(['k1'])
})

test('refusal: an answer of that key under way, else the list is full', () => {
  expect(refusal([answer(1, 'running')], 'k1')).toBe('inFlight')
  expect(refusal([answer(1, 'done')], 'k1')).toBe('full')
})
