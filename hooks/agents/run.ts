// The questions of one session: a question added and queued, three answered at once by a direct model call, each reply its answer.
// No `$` here: register.ts builds the QuestionIO from it, as it builds the PageIO.
import type { Texts } from '../i18n'
import type { Answer, Slot } from '../model'
import { addAnswer, markDone, markFailed, markRunning } from './answers'
import { type Ask, isUnknownFile, newAnswer, nextAnswerId, questionOf } from './ask'
import { questionBrief, SYSTEM_PROMPT } from './brief'
import { failedKeys, mapAnswers, refusal, toStart } from './queue'
import { fileWindow } from './window'

export const MODEL = 'sonnet'
export const MAX_TOKENS = 2_000
export const TIMEOUT_MS = 120_000

export type QuestionRequest = { model: string; effort: 'medium'; system: string; prompt: string; maxTokens: number; timeoutMs: number }

/** What the questions need of Claude Code. */
export type QuestionIO = {
  t: Texts
  now: () => Promise<number>
  slots: () => readonly Slot[]
  /** Replaces the slots at once (a start meanwhile sees the change), then publishes them. */
  setSlots: (slots: Slot[]) => Promise<void>
  /** One press, one send: true when `key` is not the last question sent; it is from now on (a compare-and-set). */
  claim: (key: string) => Promise<boolean>
  /** These questions may be asked again (a refusal, a failure). */
  release: (keys: readonly string[]) => Promise<void>
  toast: (text: string) => void
  /** A file of the folder `root` (or of the PR whose root it is) by its path in the diff: its text; rejects when it cannot be read. */
  readFile: (root: string, path: string) => Promise<string>
  /** One completion: the reply's text, or why there is none; rejects only when the engine refuses to send it. */
  complete: (request: QuestionRequest) => Promise<{ text: string } | { error: string }>
}

/** A change to the answers, published; a question that failed may be asked again (« Réessayer »). */
async function change(io: QuestionIO, update: (list: readonly Answer[]) => Answer[]): Promise<void> {
  const before = io.slots()
  const after = mapAnswers(before, update)
  const failed = failedKeys(before, after)
  const published = io.setSlots(after)
  if (failed.length > 0) await io.release(failed)
  await published
}

/** A question of the page goes to the model, never to the conversation: one press, one send; a refusal says why. */
export async function askQuestion(io: QuestionIO, ask: Ask): Promise<void> {
  const at = new Date(await io.now()).toISOString()
  const draft = () => newAnswer(io.t, io.slots().find(s => s.root === ask.root), ask, nextAnswerId(io.slots()), at)
  const key = draft()?.key
  if (key === undefined) {
    if (isUnknownFile(io.slots().find(s => s.root === ask.root), ask)) io.toast(io.t.answer.refused.unknownFile)
    return
  }
  if (!(await io.claim(key))) return
  const answer = draft()
  const slot = io.slots().find(s => s.root === ask.root)
  if (!answer || !slot) return io.release([key]) // gone meanwhile: nothing was sent
  const answers = addAnswer(slot.answers, answer)
  if (!answers.some(a => a.id === answer.id)) {
    io.toast(io.t.answer.refused[refusal(slot.answers, key)])
    return io.release([key])
  }
  await io.setSlots(io.slots().map(s => (s === slot ? { ...s, answers } : s)))
  await startQuestions(io)
}

/** The request for one question: its data, and the file around its lines when it can be read. */
async function requestOf(io: QuestionIO, root: string, answer: Answer): Promise<QuestionRequest> {
  const slot = io.slots().find(s => s.root === root)!
  const question = questionOf(io.t, slot, answer)
  const { path, lines } = answer
  if (path !== undefined && lines !== undefined) {
    const file = await io.readFile(root, path).then(text => fileWindow(text, lines), () => undefined)
    if (file) question.file = file
  }
  return { model: MODEL, effort: 'medium', system: SYSTEM_PROMPT, prompt: questionBrief(io.t, question), maxTokens: MAX_TOKENS, timeoutMs: TIMEOUT_MS }
}

/** One question to the model: its reply is the answer, else it fails with why; then the next ones start. */
async function answerOne(io: QuestionIO, root: string, answer: Answer): Promise<void> {
  const reply = await requestOf(io, root, answer).then(request => io.complete(request)).catch(() => null)
  const doneAt = new Date(await io.now()).toISOString()
  await change(io, list => {
    if (reply === null) return markFailed(list, answer.id, 'failed')
    if ('error' in reply) return markFailed(list, answer.id, 'failed', reply.error)
    return reply.text.trim() === '' ? markFailed(list, answer.id, 'failed', 'empty-reply') : markDone(list, answer.id, reply.text, doneAt)
  })
  await startQuestions(io)
}

/** Starts what the queue allows (three at most), in the order asked; each one that ends starts the next. */
export async function startQuestions(io: QuestionIO): Promise<void> {
  for (let next = toStart(io.slots())[0]; next; next = toStart(io.slots())[0]) {
    const { root, answer } = next
    await change(io, list => markRunning(list, answer.id)) // taken: a start meanwhile leaves it
    void answerOne(io, root, answer).catch(() => undefined)
  }
}
