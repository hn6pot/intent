// The questions' bookkeeping around a fake model call: what is sent, the queue of three, the answers and failures.
import { expect, test } from 'claude-code/testing'
import { SYSTEM_PROMPT } from '../../hooks/agents/brief'
import { askQuestion, type QuestionIO, type QuestionRequest } from '../../hooks/agents/run'
import { texts } from '../../hooks/i18n'
import type { Review, Slot } from '../../hooks/model'
import { hereQuestion, joinPath } from '../../hooks/questions'
import { newSlot } from '../../hooks/review/slots'

const HUNK = '@@ -1,2 +1,3 @@'
const review: Review = {
  source: { kind: 'conversation', repo: '/repo', ref: 'main' },
  diffHash: 'h1',
  summary: 'Résumé',
  intentions: [{ id: 1, title: 'Valider', why: 'Éviter les erreurs', origin: 'conversation' }],
  files: [{ path: 'a.ts', role: 'Rôle', importance: 'key', status: 'modified', changes: [{ hunk: HUNK, lines: [1, 3], intention: 1, explanation: 'Ajoute a', text: '+a' }] }],
  skipped: [],
  generatedAt: '2026-10-19T10:00:00.000Z',
}

type Reply = { text: string } | { error: string } | 'reject'
type Call = { request: QuestionRequest; answer: (reply: Reply) => void }

/** `hold`: each call waits until the test answers it; else every call gets `reply` at once. */
function world(options: { hold?: boolean; reply?: Reply; files?: Record<string, string> } = {}) {
  const w = {
    slots: [{ ...newSlot('/repo', { start: 'h0', preexisting: [] }), review }] as Slot[],
    published: [] as Slot[][],
    lastSent: null as string | null,
    toasts: [] as string[],
    calls: [] as Call[],
    reads: [] as string[],
    readArgs: [] as [string, string][],
    now: 0,
  }
  const files = options.files ?? { '/repo/a.ts': 'const a = 1\nconst b = 2\nconst c = 3\n' }
  const io: QuestionIO = {
    t: texts('fr'),
    now: async () => w.now,
    slots: () => w.slots,
    setSlots: async slots => void ((w.slots = slots), w.published.push(slots)),
    claim: async key => {
      const fresh = w.lastSent !== key
      w.lastSent = key
      return fresh
    },
    release: async keys => void (w.lastSent !== null && keys.includes(w.lastSent) && (w.lastSent = null)),
    toast: text => void w.toasts.push(text),
    readFile: async (root, relative) => {
      const path = joinPath(root, relative)
      w.readArgs.push([root, relative])
      w.reads.push(path)
      if (!(path in files)) throw new Error('ENOENT')
      return files[path]!
    },
    complete: request =>
      new Promise((resolve, reject) => {
        const answer = (reply: Reply) => (reply === 'reject' ? reject(new Error('refused')) : resolve(reply))
        w.calls.push({ request, answer })
        if (!options.hold) answer(options.reply ?? { text: 'Voici le déroulé.' })
      }),
  }
  return { w, io }
}
const answers = (w: { slots: Slot[] }) => w.slots[0]!.answers
/** What the calls started settles. */
const settle = async () => {
  for (let n = 0; n < 30; n++) await Promise.resolve()
}
const free = (text: string) => ({ kind: 'free' as const, root: '/repo', text })
const here = { kind: 'here' as const, root: '/repo', path: 'a.ts', hunk: HUNK }

test('a question: one direct call to sonnet with its data in tagged blocks and the file around its lines', async () => {
  const { w, io } = world()
  await askQuestion(io, here)
  await settle()
  expect(w.calls).toHaveLength(1)
  const { request } = w.calls[0]!
  expect(request).toMatchObject({ model: 'sonnet', effort: 'medium', system: SYSTEM_PROMPT, maxTokens: 2000, timeoutMs: 120_000 })
  expect(w.reads).toEqual(['/repo/a.ts'])
  const file = review.files[0]!
  for (const part of ['<excerpt>\n+a\n</excerpt>', '<review_summary>\nRésumé\n</review_summary>', '<intention>\nValider: Éviter les erreurs\n</intention>', hereQuestion(texts('fr'), '/repo', file, file.changes[0]!)]) {
    expect(request.prompt).toContain(part)
  }
  expect(request.prompt).toContain('<file>\n1: const a = 1\n2: const b = 2\n3: const c = 3\n</file>')
  expect(request.prompt).toContain('lines 1-3 of 3')
})

test('a question on a PR slot reads its file through the PR root and the path, as it does for a folder', async () => {
  const { w, io } = world({ files: { 'pr:o/r#3/a.ts': 'const a = 1\nconst b = 2\nconst c = 3\n' } })
  w.slots = [{ ...newSlot('pr:o/r#3', { start: '', preexisting: [] }), review, pr: { slug: 'o/r', number: 3, head: 'head3', clone: '/clone', narrow: false } }]
  await askQuestion(io, { ...here, root: 'pr:o/r#3' })
  await settle()
  expect(w.readArgs).toEqual([['pr:o/r#3', 'a.ts']])
  expect(w.calls[0]!.request.prompt).toContain('<file>\n1: const a = 1')
})

test('answered: the answer is done with its text and when it came; the same question stays locked', async () => {
  const { w, io } = world({ hold: true })
  await askQuestion(io, here)
  await settle()
  expect(answers(w)).toEqual([expect.objectContaining({ status: 'running' })])
  w.now = 60_000
  w.calls[0]!.answer({ text: 'Voici le déroulé.' })
  await settle()
  expect(answers(w)).toEqual([expect.objectContaining({ status: 'done', answer: 'Voici le déroulé.', error: null, doneAt: '1970-01-01T00:01:00.000Z' })])
  expect(w.published.at(-1)).toBe(w.slots)
  expect(w.lastSent).not.toBeNull() // done: the same question stays locked until another one goes
})

test('an answer is cut at 4 000 characters', async () => {
  const { w, io } = world({ reply: { text: 'x'.repeat(5000) } })
  await askQuestion(io, here)
  await settle()
  expect(answers(w)[0]!.answer).toHaveLength(4000)
})

test('not answered: the question fails with the reason, unlocks, and « Réessayer » sends it again', async () => {
  const { w, io } = world({ reply: { error: 'api-error 529 (overloaded)' } })
  await askQuestion(io, free('pourquoi ?'))
  await settle()
  expect(answers(w)).toEqual([expect.objectContaining({ status: 'failed', error: 'failed', reason: 'api-error 529 (overloaded)', answer: '' })])
  expect(w.lastSent).toBeNull()
  await askQuestion(io, free('pourquoi ?'))
  await settle()
  expect(w.calls).toHaveLength(2)
})

test('an empty reply, or a call the engine refused to send: failed, and unlocked', async () => {
  const empty = world({ reply: { text: '  ' } })
  await askQuestion(empty.io, free('pourquoi ?'))
  await settle()
  expect(answers(empty.w)).toEqual([expect.objectContaining({ status: 'failed', error: 'failed', reason: 'empty-reply' })])
  const refused = world({ reply: 'reject' })
  await askQuestion(refused.io, free('pourquoi ?'))
  await settle()
  expect(answers(refused.w)).toEqual([expect.objectContaining({ status: 'failed', error: 'failed' })])
  expect(answers(refused.w)[0]).not.toHaveProperty('reason')
  expect(refused.w.lastSent).toBeNull()
})

test('four questions: three calls at once, the fourth once one ends, in the order asked', async () => {
  const { w, io } = world({ hold: true })
  for (const text of ['un ?', 'deux ?', 'trois ?', 'quatre ?']) await askQuestion(io, free(text))
  await settle()
  expect(w.calls.map(c => /<question>\n.*: (.*)\n<\/question>/.exec(c.request.prompt)?.[1])).toEqual(['un ?', 'deux ?', 'trois ?'])
  expect(answers(w).map(a => a.status)).toEqual(['running', 'running', 'running', 'waiting'])
  w.calls[1]!.answer({ text: 'Réponse deux.' })
  await settle()
  expect(w.calls).toHaveLength(4)
  expect(w.calls[3]!.request.prompt).toContain('quatre ?')
  expect(answers(w).map(a => a.status)).toEqual(['running', 'done', 'running', 'running'])
})

test('a file that cannot be read: no <file> block, the question goes all the same', async () => {
  const { w, io } = world({ files: {} })
  await askQuestion(io, here)
  await settle()
  expect(w.calls).toHaveLength(1)
  expect(w.calls[0]!.request.prompt).not.toContain('<file>')
  expect(w.calls[0]!.request.prompt).toContain('<excerpt>')
  expect(answers(w)[0]!.status).toBe('done')
})

test('a free question: no file read; the summary, the intentions and the reviewed files with their roles', async () => {
  const { w, io } = world()
  await askQuestion(io, free('pourquoi ?'))
  await settle()
  expect(w.reads).toEqual([])
  const { prompt } = w.calls[0]!.request
  expect(prompt).not.toContain('<file>')
  expect(prompt).toContain('<review_summary>\nRésumé\n</review_summary>')
  expect(prompt).toContain('<intentions>\nValider: Éviter les erreurs\n</intentions>')
  expect(prompt).toContain('<reviewed_files>\na.ts: Rôle\n</reviewed_files>')
})

test('one press, one send: the same question again before another is nothing', async () => {
  const { w, io } = world({ hold: true })
  await askQuestion(io, free('pourquoi ?'))
  await askQuestion(io, free(' pourquoi ? '))
  await settle()
  expect(w.calls).toHaveLength(1)
  expect(w.toasts).toEqual([])
})

test('a question still under way, asked again after another: a toast says so, and it unlocks', async () => {
  const { w, io } = world({ hold: true })
  for (const text of ['un ?', 'deux ?', 'un ?']) await askQuestion(io, free(text))
  await settle()
  expect(w.calls).toHaveLength(2)
  expect(w.toasts).toEqual(['Cette question est déjà en cours.'])
  expect(w.lastSent).toBeNull()
})

test('past 50 questions under way, a toast says the list is full', async () => {
  const { w, io } = world({ hold: true })
  for (let n = 1; n <= 51; n++) await askQuestion(io, free(`question ${n} ?`))
  await settle()
  expect(answers(w)).toHaveLength(50)
  expect(w.calls).toHaveLength(3)
  expect(w.toasts).toEqual(['Trop de questions en cours : attends une réponse.'])
})

test('a selection in a file the review does not have is refused, with a toast', async () => {
  const { w, io } = world()
  await askQuestion(io, { kind: 'selection', root: '/repo', path: 'other.ts', from: 1, to: 2, text: 'x' })
  expect(answers(w)).toEqual([])
  expect(w.calls).toEqual([])
  expect(w.toasts).toEqual(["Ce fichier n'est pas dans la revue."])
  expect(w.lastSent).toBeNull()
})
