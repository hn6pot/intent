import { expect, test } from 'claude-code/testing'
import type { Answer } from '../../hooks/model'
import { addAnswer, interruptRunning, markDone, markFailed, markRunning, nextToStart } from '../../hooks/agents/answers'

const input = (n: number, extra: Partial<Answer> = {}) => ({
  id: `a-${n}`, key: `k${n}`, kind: 'free' as const, question: `q${n}`, at: `2026-10-19T10:00:${String(n % 60).padStart(2, '0')}.000Z`, ...extra,
})
const answer = (n: number, status: Answer['status'], extra: Partial<Answer> = {}): Answer => ({
  ...input(n), answer: '', status, error: null, ...extra,
})

test('addAnswer: a new answer waits, empty, and the list it received is untouched', () => {
  const before: Answer[] = []
  const list = addAnswer(before, input(1, { kind: 'here', path: 'a.ts', lines: [3, 5], excerpt: 'x' }))
  expect(list).toEqual([{ ...input(1, { kind: 'here', path: 'a.ts', lines: [3, 5], excerpt: 'x' }), answer: '', status: 'waiting', error: null }])
  expect(before).toEqual([])
})

test('addAnswer: the same key while waiting or running is not added again', () => {
  const waiting = addAnswer([], input(1))
  expect(addAnswer(waiting, input(2, { key: 'k1' }))).toEqual(waiting)
  const running = [answer(1, 'running')]
  expect(addAnswer(running, input(2, { key: 'k1' }))).toEqual(running)
})

test('addAnswer: the same key after it finished or failed is added (retry)', () => {
  expect(addAnswer([answer(1, 'done')], input(2, { key: 'k1' }))).toHaveLength(2)
  expect(addAnswer([answer(1, 'failed')], input(2, { key: 'k1' }))).toHaveLength(2)
})

test('addAnswer: the 51st answer pushes out the oldest finished one', () => {
  const full = Array.from({ length: 50 }, (_, i) => answer(i + 1, i === 0 ? 'running' : 'done'))
  const list = addAnswer(full, input(51))
  expect(list).toHaveLength(50)
  expect(list.map(a => a.id)).not.toContain('a-2')
  expect(list.map(a => a.id)).toContain('a-1')
  expect(list[list.length - 1]!.id).toBe('a-51')
})

test('addAnswer: failed ones go too, before waiting and running ones, even when older', () => {
  const full = [answer(1, 'waiting'), answer(2, 'running'), answer(3, 'failed'), ...Array.from({ length: 47 }, (_, i) => answer(i + 4, 'waiting', { key: `w${i}` }))]
  const list = addAnswer(full, input(60))
  expect(list).toHaveLength(50)
  expect(list.map(a => a.id)).not.toContain('a-3')
  expect(list.map(a => a.id)).toContain('a-1')
})

test('addAnswer: a running answer survives the 51st, even the oldest', () => {
  const full = [answer(1, 'running'), answer(2, 'done'), ...Array.from({ length: 48 }, (_, i) => answer(i + 3, 'waiting', { key: `w${i}` }))]
  const list = addAnswer(full, input(60))
  expect(list).toHaveLength(50)
  expect(list[0]).toMatchObject({ id: 'a-1', status: 'running' })
  expect(list.map(a => a.id)).not.toContain('a-2')
  expect(list[list.length - 1]!.id).toBe('a-60')
})

test('addAnswer: with only waiting and running ones the 51st is refused, nothing is evicted', () => {
  const full = Array.from({ length: 50 }, (_, i) => answer(i + 1, i < 3 ? 'running' : 'waiting'))
  const list = addAnswer(full, input(51))
  expect(list).toEqual(full)
  expect(list).not.toBe(full)
})

test('nextToStart: two running, three waiting, one slot left: the oldest waiting only', () => {
  const all = [answer(1, 'running'), answer(2, 'running'), answer(3, 'waiting'), answer(4, 'waiting'), answer(5, 'waiting')]
  expect(nextToStart(all).map(a => a.id)).toEqual(['a-3'])
})

test('nextToStart: nothing when three are running, and a done one does not count', () => {
  const busy = [answer(1, 'running'), answer(2, 'running'), answer(3, 'running'), answer(4, 'waiting')]
  expect(nextToStart(busy)).toEqual([])
  expect(nextToStart([answer(1, 'done'), answer(2, 'waiting'), answer(3, 'waiting'), answer(4, 'waiting'), answer(5, 'waiting')]).map(a => a.id)).toEqual(['a-2', 'a-3', 'a-4'])
})

test('nextToStart: max is a parameter', () => {
  expect(nextToStart([answer(1, 'waiting'), answer(2, 'waiting')], 1).map(a => a.id)).toEqual(['a-1'])
})

test('markRunning: the answer runs, the others stay', () => {
  const list = markRunning([answer(1, 'waiting'), answer(2, 'waiting')], 'a-2')
  expect(list[0]).toEqual(answer(1, 'waiting'))
  expect(list[1]).toMatchObject({ status: 'running' })
})

test('markDone: found by id, text kept; cut to 4 000 characters', () => {
  const running = [answer(1, 'running')]
  const at = '2026-10-19T10:05:00.000Z'
  expect(markDone(running, 'a-1', 'Because.', at)[0]).toMatchObject({ status: 'done', answer: 'Because.', error: null, doneAt: at })
  expect(markDone(running, 'a-1', 'x'.repeat(5000), at)[0]!.answer).toHaveLength(4000)
  expect(markDone(running, 'other', 'x', at)).toEqual(running)
})

test('markDone: a late reply does not touch a failed or an already done answer', () => {
  const list = [answer(1, 'failed', { error: 'interrupted' }), answer(2, 'done', { answer: 'first' })]
  expect(markDone(list, 'a-1', 'late', '2026-10-19T10:05:00.000Z')).toEqual(list)
  expect(markDone(list, 'a-2', 'late', '2026-10-19T10:05:00.000Z')).toEqual(list)
})

test('markFailed: found by id, with the reason when there is one', () => {
  const list = [answer(1, 'waiting'), answer(2, 'running')]
  expect(markFailed(list, 'a-1', 'failed')[0]).toMatchObject({ status: 'failed', error: 'failed' })
  expect(markFailed(list, 'a-1', 'failed')[0]).not.toHaveProperty('reason')
  expect(markFailed(list, 'a-2', 'failed', 'api-error 529 (overloaded)')[1]).toMatchObject({ error: 'failed', reason: 'api-error 529 (overloaded)' })
  expect(markFailed(list, 'nobody', 'failed')).toEqual(list)
})

test('markFailed: a late failure does not turn a done answer into a failed one, nor change a failed one', () => {
  const list = [answer(1, 'done', { answer: 'ok' }), answer(2, 'failed', { error: 'interrupted' })]
  expect(markFailed(list, 'a-1', 'failed')).toEqual(list)
  expect(markFailed(list, 'a-2', 'failed', 'aborted')).toEqual(list)
})

test('interruptRunning: running and waiting ones fail as interrupted, finished ones stay', () => {
  const list = interruptRunning([answer(1, 'running'), answer(2, 'waiting'), answer(3, 'done', { answer: 'ok' }), answer(4, 'failed', { error: 'failed' })])
  expect(list.map(a => [a.status, a.error])).toEqual([['failed', 'interrupted'], ['failed', 'interrupted'], ['done', null], ['failed', 'failed']])
})
