import { expect, test } from 'claude-code/testing'
import { texts } from '../../hooks/i18n'
import type { Diff, Review } from '../../hooks/model'
import { type Complete, generateReview } from '../../hooks/review/generate'
import type { TranscriptMessage } from '../../hooks/review/transcript'

const hunk = '@@ -1,2 +1,3 @@ function a()'
const diff: Diff = {
  files: [{ path: 'src/a.ts', status: 'modified', binary: false, hunks: [{ header: hunk, newStart: 1, newLines: 3, text: `${hunk}\n+added` }] }],
  hash: 'h1',
  chars: 30,
  skipped: [],
}
const validReply = JSON.stringify({
  summary: 'Résumé',
  intentions: [{ id: 1, title: 'T1', why: 'W1', origin: 'conversation' }],
  files: [{ path: 'src/a.ts', role: 'Rôle', importance: 'key', status: 'modified', changes: [{ hunk, lines: [1, 3], intention: 1, explanation: 'Ajoute a' }] }],
})
const transcript: TranscriptMessage[] = [{ role: 'user', text: 'Ajoute a', toolUses: [] }]

type Request = Parameters<Complete>[0]
type Reply = string | { error: string }

/** A Complete that answers each call with the next reply, and records the requests it received. */
function fakeComplete(replies: Reply[]) {
  const requests: Request[] = []
  const complete: Complete = async request => {
    requests.push(request)
    const next = replies.shift()
    if (next === undefined) throw new Error('no reply left')
    return typeof next === 'string' ? { text: next } : next
  }
  return { complete, requests }
}

const input = {
  t: texts('fr'),
  repo: '/r',
  ref: 'main',
  diff,
  transcript,
  previous: null,
  now: Date.UTC(2026, 9, 17, 10, 0, 0),
}

const isReview = (result: Review | { error: string }): result is Review => !('error' in result)

test('a valid first reply is the review, after a single call', async () => {
  const { complete, requests } = fakeComplete([validReply])
  const result = await generateReview(complete, input)
  expect(requests).toHaveLength(1)
  expect(isReview(result)).toBe(true)
  expect(isReview(result) ? result.summary : '').toBe('Résumé')
  expect(isReview(result) ? result.diffHash : '').toBe('h1')
})

test('an invalid first reply is retried once with the same request', async () => {
  const { complete, requests } = fakeComplete(['not json at all', validReply])
  const result = await generateReview(complete, input)
  expect(requests).toHaveLength(2)
  expect(requests[1]).toEqual(requests[0])
  expect(isReview(result)).toBe(true)
})

test('two invalid replies: an invalid reply, the code the pane translates', async () => {
  const { complete, requests } = fakeComplete(['not json at all', 'still not json'])
  expect(await generateReview(complete, input)).toEqual({ error: 'invalidReply' })
  expect(requests).toHaveLength(2)
})

test('a failed call is retried once, and a valid retry gives the review', async () => {
  const { complete, requests } = fakeComplete([{ error: 'network down' }, validReply])
  const result = await generateReview(complete, input)
  expect(requests).toHaveLength(2)
  expect(isReview(result)).toBe(true)
})

test('two failed calls: a model failure, the code the pane translates', async () => {
  const { complete, requests } = fakeComplete([{ error: 'network down' }, { error: 'timeout' }])
  expect(await generateReview(complete, input)).toEqual({ error: 'model' })
  expect(requests).toHaveLength(2)
})

test('every call asks sonnet, with low effort, 16000 tokens and a 120 s timeout', async () => {
  const { complete, requests } = fakeComplete([validReply])
  await generateReview(complete, input)
  expect(requests[0].model).toBe('sonnet')
  expect(requests[0].effort).toBe('low')
  expect(requests[0].maxTokens).toBe(16_000)
  expect(requests[0].timeoutMs).toBe(120_000)
  expect(requests[0].prompt).toContain('src/a.ts')
  expect(requests[0].system.length > 0).toBe(true)
})

test('the new files the diff left out are in the review skipped list', async () => {
  const { complete } = fakeComplete([validReply])
  const result = await generateReview(complete, { ...input, diff: { ...diff, skipped: ['many/n50.ts'] } })
  expect(isReview(result) ? result.skipped : []).toEqual(['many/n50.ts'])
})

test('the pull request, an empty transcript and inferredOnly reach the review', async () => {
  const { complete, requests } = fakeComplete([validReply])
  const result = await generateReview(complete, {
    ...input,
    transcript: [],
    kind: 'pr',
    inferredOnly: true,
    pr: { title: 'PR_TITLE', body: 'PR_BODY', commits: ['feat: one'] },
  })
  expect(requests[0].prompt).toContain('<pr_title>\nPR_TITLE\n</pr_title>')
  expect(requests[0].prompt).not.toContain('## Conversation excerpt')
  if (!isReview(result)) throw new Error(result.error)
  expect(result.source.kind).toBe('pr')
  expect(result.intentions.map(item => item.origin)).toEqual(['inferred'])
})

test('by default the review is a conversation one and keeps the origins of the model', async () => {
  const { complete } = fakeComplete([validReply])
  const result = await generateReview(complete, input)
  if (!isReview(result)) throw new Error(result.error)
  expect(result.source.kind).toBe('conversation')
  expect(result.intentions[0].origin).toBe('conversation')
})
