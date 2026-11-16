import { expect, test } from 'claude-code/testing'
import type { Failure } from '../../hooks/model'
import { TEXTS } from '../../page/texts.js'

/** The shape of a value, recursively: functions compare as 'function', objects by their keys. */
const shape = (value: unknown): unknown =>
  typeof value === 'function'
    ? 'function'
    : typeof value === 'object' && value !== null
      ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]))
      : typeof value

test("the page's French and English texts have exactly the same keys", () => {
  expect(shape(TEXTS.en)).toEqual(shape(TEXTS.fr))
})

test('the Sources column words: the two headings, in both languages', () => {
  expect([TEXTS.fr.conversationPrs, TEXTS.fr.viewedPrs]).toEqual(['PR de cette conversation', 'PR regardées'])
  expect([TEXTS.en.conversationPrs, TEXTS.en.viewedPrs]).toEqual(["This conversation's PRs", 'Viewed PRs'])
  expect(Object.keys(TEXTS.fr.prState)).toEqual(['open', 'merged', 'closed', 'null'])
  expect(TEXTS.fr.prState.null).toBe('inaccessible')
  expect(TEXTS.en.prState.null).toBe('unreachable')
})

test('every reason a review can fail has its words on the page, in both languages', () => {
  const failures: Failure[] = ['invalidReply', 'model', 'git', 'truncated', 'github']
  for (const lang of [TEXTS.fr, TEXTS.en]) for (const failure of failures) expect(typeof lang.failure[failure]).toBe('string')
  expect(TEXTS.fr.failure.github).toBe('GitHub ne répond pas (gh)')
  expect(TEXTS.en.failure.github).toBe('GitHub did not answer (gh)')
})
