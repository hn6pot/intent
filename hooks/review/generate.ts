// Asks the model for a review and retries once when the call fails or the reply is not a valid review.
import type { Texts } from '../i18n'
import type { Diff, Failure, Review } from '../model'
import { buildRequest } from './prompt'
import { parseReview } from './parse'
import { fitDiff } from './skip'
import { type TranscriptMessage, reduceTranscript } from './transcript'

export type Complete = (request: {
  model: string
  system: string
  prompt: string
  effort: 'low'
  maxTokens: number
  timeoutMs: number
}) => Promise<{ text: string } | { error: string }>

export const MODEL = 'sonnet'
export const MAX_TOKENS = 16_000
export const TIMEOUT_MS = 120_000
const ATTEMPTS = 2

/** One call, then one retry with the same request if the call fails or its reply does not parse. */
export async function generateReview(
  complete: Complete,
  input: {
    t: Texts
    repo: string
    ref: string
    diff: Diff
    /** May be empty (a review of a PR): the request then has no conversation excerpt. */
    transcript: readonly TranscriptMessage[]
    previous: Review | null
    now: number
    /** Default 'conversation'. */
    kind?: 'conversation' | 'pr'
    pr?: { title: string; body: string; commits: string[] }
    /** Default false: every intention of the review is forced to "inferred". */
    inferredOnly?: boolean
  },
): Promise<Review | { error: Failure }> {
  const { full, headersOnly, skipped } = fitDiff(input.diff.files)
  const { system, prompt } = buildRequest({
    t: input.t,
    repo: input.repo,
    full,
    headersOnly,
    transcript: reduceTranscript(input.transcript),
    previous: input.previous,
    pr: input.pr,
  })

  let error: Failure = 'model'
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const reply = await complete({ model: MODEL, system, prompt, effort: 'low', maxTokens: MAX_TOKENS, timeoutMs: TIMEOUT_MS })
    if ('error' in reply) {
      error = 'model'
      continue
    }
    const result = parseReview(reply.text, input.diff.files, {
      repo: input.repo,
      ref: input.ref,
      diffHash: input.diff.hash,
      skipped: [...skipped, ...input.diff.skipped],
      now: input.now,
      kind: input.kind ?? 'conversation',
      inferredOnly: input.inferredOnly ?? false,
    })
    if (!('error' in result)) return result
    error = 'invalidReply'
  }
  return { error }
}
