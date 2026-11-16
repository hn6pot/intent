import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'
import { texts } from '../hooks/i18n'
import type { Answer, Slot } from '../hooks/model'
import type { Saved } from '../hooks/review/slots'
import { hereKey, hereQuestion, selectionQuestion } from '../hooks/questions'
import { hashText } from '../hooks/repos/diff'

test('/intent opens the pane and answers nothing in the thread', { options: { language: 'fr' } }, async ($, on) => {
  // The kit answers neither session.start nor $ calls: we play the engine.
  const opened: unknown[] = []
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', async (_$, e) => (opened.push(e), { value: { isPlaced: true } }))
  await $.session.start({ cwd: '/tmp', surface: null, isInteractive: false } as never)
  expect(await $.command.run({ command: 'intent', args: '' } as never)).toEqual({})
  expect(opened).toEqual([{ id: 'intent', title: 'Revue', focus: true }])
})

test('the pane falls through to the engine on mobile, which has no Input or Select', async ($, on) => {
  // The engine's own drawing, a Text; the pane would have thrown on the missing Input.
  on('ui.render', async (kit, e) => kit.ui.resolve(e).Text({ children: 'engine drawing' }))
  const drawn = await $.ui.render({ component: 'Pane', requestId: 'intent', surface: 'mobile', props: {} } as never)
  expect(JSON.stringify(drawn)).toContain('engine drawing')
})

// A minimal engine: git simulated by command pattern, a model that answers a valid review, a store in memory.
const HUNK = '@@ -1,2 +1,3 @@ function a()'
const diffOf = (line: string) =>
  `diff --git a/src/a.ts b/src/a.ts\nindex 1111111..2222222 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n${HUNK}\n x\n+${line}\n y\n`
const REPLY = JSON.stringify({
  summary: 'Résumé',
  intentions: [{ id: 1, title: 'T1', why: 'W1', origin: 'conversation' }],
  files: [{ path: 'src/a.ts', role: 'Rôle', importance: 'key', status: 'modified', changes: [{ hunk: HUNK, lines: [1, 3], intention: 1, explanation: 'Ajoute a' }] }],
})

// A second hunk, for a review with two questions to ask.
const HUNK_B = '@@ -9,2 +9,3 @@ function b()'
const TWO_HUNKS = `${diffOf('added')}${HUNK_B}\n z\n+more\n w\n`
const TWO_REPLY = JSON.stringify({
  ...JSON.parse(REPLY),
  files: [{
    path: 'src/a.ts', role: 'Rôle', importance: 'key', status: 'modified',
    changes: [{ hunk: HUNK, lines: [1, 3], intention: 1, explanation: 'Ajoute a' }, { hunk: HUNK_B, lines: [9, 11], intention: 1, explanation: 'Ajoute b' }],
  }],
})

type World = {
  surfaces: string[]
  diff: string
  /** What the model answers. */
  reply: string
  diffFails: boolean
  /** The folder no longer exists: even `rev-parse --show-toplevel` fails. */
  gone: boolean
  /** `git diff` wrote more than the engine keeps. */
  truncated: boolean
  /** Folders that do not exist (yet). */
  missing: string[]
  /** How many writes of this session the store refuses (it is full). */
  refusedSets: number
  /** `git diff` cannot start (a rejection of $.process.run). */
  diffRejects: boolean
  /** When set, the model answers only once the test calls it. */
  hold: boolean
  release: (() => void)[]
  store: Map<string, unknown>
  runs: string[]
  /** Every model call, reviews and questions, by its input. */
  models: { model: string; prompt: string; system?: string; effort?: string; maxTokens?: number; timeoutMs?: number }[]
  opened: unknown[]
  submitted: string[]
  toasts: unknown[]
  storeSets: string[]
  /** `/usr/bin/python3` answers that it is recent enough. */
  python: boolean
  /** What the review server writes on stdout once started, piece by piece. */
  server: string[]
  /** The server keeps running after its pieces, until the mod stops it (each settle then takes about a second); else it ends there. */
  serverHolds: boolean
  /** Each server started, by its argv. */
  spawns: string[][]
  /** Writes one more piece on the running server's stdout. */
  say: (text: string) => void
  /** The running server was stopped by the mod. */
  stopped: boolean
  /** `fs.write`: path to text, in order. */
  writes: [string, string][]
  /** State as it stood before the module loaded (a reload): read until written. */
  restored: Map<string, unknown>
  /** Every state write, last value per key. */
  state: Map<string, unknown>
  /** Every value the page state took, in order. */
  pages: unknown[]
  /** The tools `tool.list` names. */
  tools: string[]
  /** Each Artifact call, by its input. */
  artifacts: Record<string, unknown>[]
  /** What the Artifact calls answer, in order; past the list, a published page. */
  artifactReplies: unknown[]
  /** Each agent spawned, by its input: the mod spawns none. */
  agents: Record<string, unknown>[]
  /** What a question's model call resolves to. */
  answerReply: unknown
  /** When set, a question's model call answers only once the test releases it, or once it is aborted. */
  holdQuestions: boolean
  releaseQuestion: (() => void)[]
  /** The conversation `session.messages` returns. */
  messages: unknown[]
  /** What each `gh` command prints (its line); null: gh fails. */
  gh: (line: string) => string | null
  /** The engine's own verdict at `tool.check` (rules, mode, PreToolUse). */
  check: { decision: 'allow' | 'ask' | 'deny'; reason?: string; rule?: string }
}

const ARTIFACT = 'https://claude.ai/artifact/abc'
/** What a question's model call answers, and the reviewed file as it is now. */
const ANSWER = 'Voici le déroulé.'
const SOURCE = 'function a() {\n  x\n  added\n  y\n}\n'
/** A model call for a question, not for a review. */
const isQuestion = (e: { prompt: string }) => e.prompt.includes('<question>')
const PAGE_FILES: Record<string, string> = {
  'index.html': '<html><head><title>Revue</title><script>boot()</script></head><body><footer id="ask"><form><input></form></footer></body></html>',
  'style.css': '.top {}',
  'app.js': "import { TEXTS } from './texts.js'\nimport { escapeHtml } from './render.js'\nimport { selectedLines } from './select.js'\n",
  'render.js': 'export const escapeHtml = x => x\n',
  'texts.js': 'export const TEXTS = {}\n',
  'select.js': 'export function selectedLines() {}\n',
}

function engine(on: On, world: Partial<World> = {}): World {
  const w: World = {
    surfaces: ['desktop'], diff: diffOf('added'), reply: REPLY, diffFails: false, diffRejects: false, gone: false, truncated: false, missing: [], refusedSets: 0, hold: false, release: [], store: new Map(),
    runs: [], models: [], opened: [], submitted: [], toasts: [], storeSets: [],
    python: false, server: ['{"type":"ready","port":4312}\n'], serverHolds: false, spawns: [], say: () => {}, stopped: false, writes: [], restored: new Map(), state: new Map(), pages: [],
    tools: [], artifacts: [], artifactReplies: [], agents: [], answerReply: { isAnswered: true, text: ANSWER, usage: {} }, holdQuestions: false, releaseQuestion: [],
    messages: [{ role: 'user', text: 'Ajoute a', toolUses: [] }], gh: () => null, check: { decision: 'ask' }, ...world,
  }
  const out = (stdout = '', exitCode = 0, isStdoutTruncated = false) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated, isStderrTruncated: false } })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('session.cwd', async () => ({ value: '/w/app' }))
  on('session.id', async () => ({ value: 'me' }))
  on('session.surfaces', async () => ({ value: w.surfaces }) as never)
  on('session.messages', async () => ({ value: w.messages }) as never)
  on('agent.spawn', async (_$, e) => {
    w.agents.push(e as never)
    return { model: 'sonnet' } as never
  })
  on('agent.offer', async () => ({ isOffered: true }))
  on('tool.check', async () => w.check)
  on('env.get', async () => ({ value: '/Users/me' }))
  on('ui.open', async (_$, e) => (w.opened.push(e), { value: { isPlaced: true } }))
  on('ui.close', async () => ({ value: undefined }) as never)
  on('ui.toast', async (_$, e) => (w.toasts.push(e), { value: undefined }) as never)
  on('prompt.submit', async (_$, e) => {
    w.submitted.push(e.text)
    return { text: e.text } as never
  })
  on('tool.call', async (_$, e) => {
    if (e.tool !== 'Artifact') return { result: 'ok' } as never
    w.artifacts.push(e as never)
    return (w.artifactReplies.shift() ?? { ref: 'r', result: { url: ARTIFACT, path: '/x' }, text: '' }) as never
  })
  on('tool.list', async () => ({ value: w.tools.map(name => ({ name, description: '', mcp: false })) }))
  // The page's files, by name: just enough of each for the standalone copy.
  on('fs.read', async (_$, e) => ({ value: e.path === '/w/app/src/a.ts' ? SOURCE : PAGE_FILES[e.path.slice(e.path.lastIndexOf('/') + 1)] ?? '' }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('store.get', async (_$, e) => ({ value: w.store.get(e.key) }))
  on('store.set', async (_$, e) => {
    if (e.key === 'session:me' && w.refusedSets > 0) {
      w.refusedSets--
      throw new Error('store full') // skipped hook, nothing beneath: the write rejects
    }
    w.storeSets.push(e.key)
    w.store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', async (_$, e) => (w.store.delete(e.key), { value: undefined }))
  on('store.keys', async () => ({ value: [...w.store.keys()] }))
  on('model.complete', async (_$, e, next) => {
    w.models.push(e)
    if (isQuestion(e)) {
      if (w.holdQuestions) await new Promise<void>(resolve => (w.releaseQuestion.push(resolve), next.signal.addEventListener('abort', () => resolve())))
      return { value: next.signal.aborted ? { isAnswered: false, reason: 'aborted', usage: {} } : w.answerReply } as never
    }
    if (w.hold) await new Promise<void>(resolve => w.release.push(resolve))
    return { value: { isAnswered: true, text: w.reply, usage: {} } } as never
  })
  on('state.get', async (_$, e, next) => (w.restored.has(e.key) ? ({ value: { value: w.restored.get(e.key), version: 0 } }) as never : next(e)))
  on('state.set', async (_$, e, next) => {
    w.restored.delete(e.key)
    w.state.set(e.key, e.value)
    if (e.key === 'page') w.pages.push(e.value)
    return next(e)
  })
  on('fs.write', async (_$, e) => (w.writes.push([e.path, e.text]), { value: undefined }))
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  // The server: its pieces, then, when held, it waits for more until the mod stops it.
  on('process.spawn', async function* (_$: unknown, e: { argv: readonly string[] }, next: { signal: AbortSignal }) {
    w.spawns.push([...e.argv])
    const queue = [...w.server]
    let wake = () => {}
    w.say = text => (queue.push(text), wake())
    next.signal.addEventListener('abort', () => wake())
    while (!next.signal.aborted) {
      while (queue.length > 0) yield { stream: 'stdout' as const, text: queue.shift()! }
      if (!w.serverHolds) return { value: { code: 1, signal: null } }
      await new Promise<void>(resolve => (wake = resolve))
    }
    w.stopped = true
    return { value: { code: null, signal: 'SIGTERM' } }
  } as never)
  on('process.run', async (_$, e) => {
    const line = e.argv.join(' ')
    w.runs.push(line)
    if (/^\/usr\/bin\/python3 -c /.test(line)) return w.python ? out('True\n') : out('', 1)
    if (/^(mv|rm|find) /.test(line)) return out('')
    const isMissing = w.missing.some(folder => line.includes(`${folder} `) || line.endsWith(folder))
    if (/rev-parse --show-toplevel/.test(line)) return w.gone || isMissing ? out('', 128) : out(line.includes('/w/other') ? '/w/other\n' : '/w/app\n')
    if (/rev-parse --abbrev-ref HEAD/.test(line)) return out('feat/x\n')
    if (/rev-parse --git-path (\S+)/.test(line)) return out(`.git/${/--git-path (\S+)/.exec(line)![1]}\n`)
    if (/^test -d /.test(line)) return out('', /rebase/.test(line) || isMissing ? 1 : 0)
    if (/rev-parse HEAD/.test(line)) return out('h0\n')
    if (/remote get-url origin/.test(line)) return out('https://github.com/acme/app.git\n')
    if (/^gh /.test(line)) return w.gh(line) === null ? out('', 1) : out(w.gh(line)!)
    if (/^git -C \S+ show head12:src\/a\.ts$/.test(line)) return out(SOURCE)
    if (/symbolic-ref/.test(line)) return out('origin/main\n')
    if (/merge-base HEAD origin\/main/.test(line)) return out('mb1\n')
    if (/ diff /.test(line) && w.diffRejects) throw new Error('git timed out')
    if (/ diff /.test(line)) return w.diffFails ? out('', 128) : out(w.diff, 0, w.truncated)
    if (/ls-files/.test(line)) return w.diffFails ? out('', 128) : out('')
    return out('', 1)
  })
  return w
}

const start = ($: Engine) => $.session.start({ cwd: '/w/app', surface: null, isInteractive: true } as never)
const edit = ($: Engine) => $.tool.call({ tool: 'Edit', tool_use_id: 't1', file_path: '/w/app/src/a.ts' } as never)
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', tool_use_id: 't2', command } as never)
const turnEnd = ($: Engine, agentId?: string) =>
  $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', ...(agentId ? { agentId } : {}) } as never)
/** Every slot change is saved: the store shows the slots as published. */
const slotsOf = (w: World) => ((w.store.get('session:me') as { slots: Slot[] } | undefined)?.slots ?? [])
/** Another plugin closing the pane. The kit raises no person's close (its `ui.close` origin is the engine's to set): that branch stays untested, as in lighthouse. */
const CLOSER = {
  name: 'closer',
  register: ((on: On) => {
    on('command.run', { command: 'close-intent' } as never, async $ => {
      await $.ui.close({ id: 'intent' })
      return {}
    })
  }) as never,
}
const closePane = ($: Engine) => $.command.run({ command: 'close-intent', args: '' } as never)
const PANE = { component: 'Pane', requestId: 'intent', props: { title: 'Revue', isFocused: false, bodyColumns: 60, placement: 'dock' } }

test('no interface: no git, no model, nothing stored', async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on, { surfaces: [] })
  await start($)
  await edit($)
  await turnEnd($)
  await clock.advance(5_000)
  expect(w.runs).toEqual([])
  expect(w.models).toEqual([])
  expect(w.storeSets).toEqual([])
})

test('an edit then a turn end generates one review', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on)
  await start($)
  await edit($)
  await turnEnd($)
  await clock.advance(3_000)
  expect(w.models).toHaveLength(1)
  expect(w.models[0]?.model).toBe('sonnet')
  const slot = slotsOf(w)[0]!
  expect(slot).toMatchObject({ root: '/w/app', name: 'app', status: 'idle', start: 'h0' })
  expect(slot.review?.summary).toBe('Résumé')
  expect(w.opened).toEqual([{ id: 'intent', title: 'Revue' }])
})

test('same diff on the next turn: no new generation', async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on)
  await start($)
  await edit($)
  await turnEnd($)
  await clock.advance(3_000)
  await turnEnd($)
  await clock.advance(3_000)
  expect(w.models).toHaveLength(1)
})

test('a close by another plugin does not stop the reviews', { plugins: [CLOSER] }, async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on)
  await start($)
  await edit($)
  await turnEnd($)
  await clock.advance(3_000)
  await closePane($)
  w.diff = diffOf('changed')
  await turnEnd($)
  await clock.advance(3_000)
  expect(w.models).toHaveLength(2)
  expect(slotsOf(w)[0]!.status).toBe('idle')
})

test('empty diff: no model call', async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on, { diff: '' })
  await start($)
  await edit($)
  await turnEnd($)
  await clock.advance(3_000)
  expect(slotsOf(w)[0]!.empty).toBe(true)
  expect(w.models).toEqual([])
})

test('folder gone: review frozen', async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on)
  await start($)
  await edit($)
  await turnEnd($)
  await clock.advance(3_000)
  w.diffFails = true
  w.gone = true
  await turnEnd($)
  await clock.advance(3_000)
  const slot = slotsOf(w)[0]!
  expect(slot.gone).toBe(true)
  expect(slot.review?.summary).toBe('Résumé')
  expect(w.toasts).toEqual([])
  expect(w.models).toHaveLength(1)
})

test('git diff failing while the folder still exists: a git failure, not gone', async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on)
  await start($)
  await edit($)
  await turnEnd($)
  await clock.advance(3_000)
  w.diffFails = true
  await turnEnd($)
  await clock.advance(3_000)
  expect(slotsOf(w)[0]).toMatchObject({ gone: false, status: 'failed', error: 'git' })
  expect(slotsOf(w)[0]!.review?.summary).toBe('Résumé')
})

test('a diff cut by the engine: a truncated failure, no model call', async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on, { truncated: true })
  await start($)
  await edit($)
  await turnEnd($)
  await clock.advance(3_000)
  expect(slotsOf(w)[0]).toMatchObject({ status: 'failed', error: 'truncated' })
  expect(w.models).toEqual([])
})

test('a command that rejects during a pass: the folder shows a git failure', async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on)
  await start($)
  await edit($)
  w.diffRejects = true
  await turnEnd($)
  await clock.advance(3_000)
  expect(slotsOf(w)[0]).toMatchObject({ status: 'failed', error: 'git' })
  expect(w.models).toEqual([])
})

test('agent turns are ignored', async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on)
  await start($)
  await edit($)
  const runs = w.runs.length
  await turnEnd($, 'ag1')
  await clock.advance(5_000)
  expect(w.runs).toHaveLength(runs)
  expect(w.models).toEqual([])
})

const answersOf = (w: World) => slotsOf(w)[0]?.answers ?? []
/** The model calls made for questions. */
const questions = (w: World) => w.models.filter(isQuestion)
/** The page's lines for « here » on the first change, and for a free question: the pane asks nothing. */
const HERE_LINE = `${JSON.stringify({ type: 'ask', kind: 'here', root: '/w/app', path: 'src/a.ts', hunk: HUNK, text: null })}\n`
const freeLine = (text: string) => `${JSON.stringify({ type: 'ask', kind: 'free', root: '/w/app', text })}\n`
/** The question last sent, locked until another one goes (the page's « Envoyé ✓ »). */
const HERE_SENT = hereKey('/w/app', 'src/a.ts', HUNK)

test('here goes to a direct model call, not to the conversation, and no agent starts', { options: { language: 'fr' } }, async ($, on) => {
  const { w, clock } = await withPage($, on)
  const review = slotsOf(w)[0]!.review!
  w.say(HERE_LINE)
  await clock.advance(0)
  const file = review.files[0]!
  expect(w.submitted).toEqual([])
  expect(w.agents).toEqual([])
  expect(questions(w)).toEqual([expect.objectContaining({ model: 'sonnet', effort: 'medium', maxTokens: 2000, timeoutMs: 120_000 })])
  const { prompt } = questions(w)[0]!
  expect(prompt).toContain(hereQuestion(texts('fr'), '/w/app', file, file.changes[0]!))
  expect(prompt).toContain('<file>\n1: function a() {\n2:   x\n3:   added\n4:   y\n5: }\n</file>')
  expect(answersOf(w)).toEqual([expect.objectContaining({ id: 'a-1', kind: 'here', path: 'src/a.ts', lines: [1, 3], status: 'done', answer: ANSWER })])
  expect(w.state.get('lastSent')).toBe(HERE_SENT) // done: still locked until another question goes
  await end($)
})

test('the mod adds no gate: tool checks, notifications and agent offers are the engine\'s alone', async ($, on) => {
  const w = engine(on)
  await start($)
  const check = (tool: string, input: unknown, agentId?: string) => $.tool.check({ tool, input, ...(agentId ? { agentId } : {}) } as never)
  expect(await check('Write', { file_path: '/w/app/x', content: '' }, 'ag1')).toEqual({ decision: 'ask' })
  w.check = { decision: 'deny', reason: 'denied by a rule', rule: 'Read(/secret/**)' }
  expect(await check('Read', { file_path: '/secret/a' })).toEqual(w.check)
  w.check = { decision: 'allow' }
  expect(await check('Bash', { command: 'rm x' }, 'ag1')).toEqual({ decision: 'allow' })
  const notification = '<task-notification>\n<task-id>ag1</task-id>\n<status>completed</status>\n</task-notification>'
  await $.prompt.submit({ text: notification, origin: { kind: 'task-notification' }, wait: false } as never)
  expect(w.submitted).toEqual([notification])
  const offer = { agent: 'intent:reader', description: '', source: 'plugin', provider: { plugin: 'intent', tier: 'user' } }
  expect(await $.agent.offer(offer as never)).toEqual({ isOffered: true })
})

test('a model call with no answer: the question fails with why, and unlocks', async ($, on) => {
  const { w, clock } = await withPage($, on, { answerReply: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: {} } })
  w.say(HERE_LINE)
  await clock.advance(0)
  expect(answersOf(w)).toEqual([expect.objectContaining({ status: 'failed', error: 'failed', reason: 'api-error 529 (overloaded)' })])
  expect(w.state.get('lastSent')).toBeNull()
  await end($)
})

test('the session ends during a question: its model call is cut', async ($, on) => {
  const { w, clock } = await withPage($, on, { holdQuestions: true })
  w.say(HERE_LINE)
  await clock.advance(0)
  expect(answersOf(w)).toEqual([expect.objectContaining({ status: 'running' })])
  await end($)
  await clock.advance(0)
  expect(answersOf(w)).toEqual([expect.objectContaining({ status: 'failed', error: 'failed', reason: 'aborted' })])
  expect(w.releaseQuestion).toHaveLength(1) // never released by the test: the abort ended it
})

test('a reload marks running answers interrupted; one saved with an agent id comes back without it', async ($, on) => {
  const answer = (id: string, status: Answer['status']): Answer => ({
    id, key: `k-${id}`, kind: 'free', question: 'q', answer: status === 'done' ? 'R' : '', status, error: null, at: '2026-10-19T10:00:00.000Z',
  })
  const old = { ...answer('a-2', 'running'), agentId: 'g-a-2' } as Answer
  const saved: Slot = { ...INTERRUPTED, answers: [answer('a-1', 'done'), old, answer('a-3', 'waiting')] }
  mock.clock(on, { now: DAY })
  const w = engine(on, { store: new Map([['session:me', { updatedAt: DAY, slots: [saved] }]]) })
  await start($)
  const answers = (w.state.get('slots') as Slot[])[0]!.answers
  expect(answers.map(a => [a.id, a.status, a.error])).toEqual([['a-1', 'done', null], ['a-2', 'failed', 'interrupted'], ['a-3', 'failed', 'interrupted']])
  expect(answers[1]).not.toHaveProperty('agentId')
  expect(questions(w)).toEqual([])
})

/** A review with two changes in one file, its page running: two "here" on the page, two questions. */
const twoChanges = ($: Engine, on: On, world: Partial<World> = {}) => withPage($, on, { diff: TWO_HUNKS, reply: TWO_REPLY, ...world })

// The guard itself: two lines read together both reach the handler before the page redraws (a double click).
test('here pressed twice at once on the page sends once', async ($, on) => {
  const { w, clock } = await twoChanges($, on)
  w.say(HERE_LINE + HERE_LINE)
  await clock.advance(0)
  expect(questions(w)).toHaveLength(1)
  await end($)
})

test('a free question from the page goes to the model too, as typed, without a file', async ($, on) => {
  const { w, clock } = await twoChanges($, on)
  w.say(freeLine(' pourquoi ? '))
  await clock.advance(0)
  expect(w.submitted).toEqual([])
  expect(questions(w)).toHaveLength(1)
  expect(questions(w)[0]!.prompt).toContain('pourquoi ?')
  expect(questions(w)[0]!.prompt).not.toContain('<file>')
  expect(answersOf(w)).toEqual([expect.objectContaining({ kind: 'free', question: 'pourquoi ?', status: 'done' })])
  await end($)
})

test('a turn end during a generation reruns it once it ends', async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on, { hold: true })
  await start($)
  await edit($)
  await turnEnd($)
  await clock.advance(3_000)
  expect(w.models).toHaveLength(1)
  w.diff = diffOf('changed')
  await turnEnd($)
  await clock.advance(3_000)
  expect(w.models).toHaveLength(1) // one generation at a time per folder
  w.release.shift()!()
  await clock.advance(0)
  expect(w.models).toHaveLength(2)
  w.release.shift()!()
  await clock.advance(0)
  expect(slotsOf(w)[0]!.status).toBe('idle')
})

/** What the mounted pane draws, read once (with a running server, each read waits for it to settle). */
const drawnOf = async (ui: { findAll(query: object): Promise<{ type: string; key: string | undefined; text: string | undefined }[]> }) =>
  (await ui.findAll({})).map(el => ({ type: el.type, key: el.key, text: el.text }))
/** Only the loading block: nothing to press, nothing of the review. */
const expectLoading = (drawn: Awaited<ReturnType<typeof drawnOf>>) => {
  expect(drawn.filter(el => el.type === 'Button' || el.type === 'Select' || el.type === 'Input' || el.type === 'Code')).toEqual([])
  expect(drawn).toContainEqual(expect.objectContaining({ type: 'Text', text: texts('fr').updating.title }))
  expect(drawn).toContainEqual(expect.objectContaining({ type: 'Text', text: texts('fr').updating.hint }))
}

test('during a generation the pane without the page shows only the loading block, then the review again', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on, { hold: true })
  await start($)
  await edit($)
  await turnEnd($)
  await clock.advance(3_000)
  expect(slotsOf(w)[0]!.status).toBe('running')
  const during = await $.ui.mount({ plugin: 'intent', surface: 'desktop', ...PANE } as never)
  const drawn = await drawnOf(during)
  expectLoading(drawn)
  expect(drawn).not.toContainEqual(expect.objectContaining({ text: texts('fr').page.error.python }))
  await during.unmount()
  w.release.shift()!()
  await clock.advance(0)
  const after = await $.ui.mount({ plugin: 'intent', surface: 'desktop', ...PANE } as never)
  expect(await after.find({ key: 'code-0-0' })).toBeDefined()
  expect(await after.find({ type: 'Text', text: texts('fr').updating.title })).toBeUndefined()
})

test('during a regeneration with the page running, the pane hides the review and every button', { options: { language: 'fr' } }, async ($, on) => {
  const { w, clock } = await withPage($, on, { hold: true })
  w.release.shift()!() // the first review comes
  await clock.advance(0)
  expect(slotsOf(w)[0]!.status).toBe('idle')
  w.diff = diffOf('changed')
  await turnEnd($)
  await clock.advance(3_000)
  expect(slotsOf(w)[0]!.status).toBe('running')
  expect(w.state.get('page')).toMatchObject({ port: 4312 })
  const ui = await $.ui.mount({ plugin: 'intent', surface: 'desktop', ...PANE } as never)
  const drawn = await drawnOf(ui)
  expectLoading(drawn)
  expect(drawn).not.toContainEqual(expect.objectContaining({ text: 'Résumé' }))
  w.release.shift()!()
  await clock.advance(0)
  await end($)
})

test('/intent during a generation: one more pass once it ends', async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on, { hold: true })
  await start($)
  await edit($)
  await turnEnd($)
  await clock.advance(3_000)
  w.diff = diffOf('changed')
  await $.command.run({ command: 'intent', args: '' } as never)
  await clock.advance(0)
  expect(w.models).toHaveLength(1)
  w.release.shift()!()
  await clock.advance(0)
  expect(w.models).toHaveLength(2)
})

const DAY = 24 * 3600 * 1000
const INTERRUPTED: Slot = {
  root: '/w/app', name: 'app', start: 'h0', preexisting: [], resetStart: false, diffHash: 'x',
  review: null, status: 'running', error: null, empty: false, gone: false, dormant: null, answers: [],
}

test('/intent regenerates a stale review', async ($, on) => {
  // A pane closed by hand is out of the kit's reach: a review cut by a restart is stale too.
  const clock = mock.clock(on, { now: DAY })
  const w = engine(on, { store: new Map([['session:me', { updatedAt: DAY, slots: [INTERRUPTED] }]]) })
  await start($)
  await $.command.run({ command: 'intent', args: '' } as never)
  await clock.advance(0)
  expect(w.models).toHaveLength(1)
  expect(slotsOf(w)[0]!.status).toBe('idle')
})

test('resume: the saved review comes back, an interrupted one stale; old sessions pruned', { options: { language: 'fr' } }, async ($, on) => {
  const store = new Map<string, unknown>([
    ['session:me', { updatedAt: 39 * DAY, slots: [INTERRUPTED] }],
    ['session:old', { updatedAt: 0, slots: [] }],
  ])
  mock.clock(on, { now: 40 * DAY })
  const w = engine(on, { store })
  await start($)
  const ui = await $.ui.mount({ plugin: 'intent', surface: 'desktop', ...PANE } as never)
  expect(await ui.find({ type: 'Text', text: 'en retard' })).toBeDefined()
  expect(await ui.find({ key: 'retry-/w/app' })).toBeDefined() // a stale review can be refreshed
  expect(w.store.has('session:old')).toBe(false)
  expect(w.store.has('session:me')).toBe(true)
})

test('the session starting in a repo with work on its branch: no pane, no model call', async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on)
  await start($)
  await turnEnd($)
  await clock.advance(3_000)
  expect(w.opened).toEqual([])
  expect(w.models).toEqual([])
})

test('/intent wakes a folder only read and reviews its branch', async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on)
  await start($)
  await turnEnd($)
  await clock.advance(3_000)
  expect(w.models).toEqual([])
  await $.command.run({ command: 'intent', args: '' } as never)
  await clock.advance(0)
  expect(w.models).toHaveLength(1)
  expect(slotsOf(w)[0]!.dormant).toBeNull()
  expect(slotsOf(w)[0]!.status).toBe('idle')
})

test('the starting folder wakes once its diff changes, then generates', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on)
  await start($)
  await turnEnd($)
  await clock.advance(3_000)
  w.diff = diffOf('changed by hand')
  await turnEnd($)
  await clock.advance(3_000)
  expect(w.models).toHaveLength(1)
  expect(w.opened).toEqual([{ id: 'intent', title: 'Revue' }])
})

test('cd and git status on a branch with work: no pane, no model call, nothing shown', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on)
  await start($)
  await bash($, 'cd /w/app && git status')
  await turnEnd($)
  await clock.advance(3_000)
  expect(w.opened).toEqual([])
  expect(w.models).toEqual([])
  const ui = await $.ui.mount({ plugin: 'intent', surface: 'desktop', ...PANE } as never)
  expect(await ui.find({ type: 'Text', text: texts('fr').noReview })).toBeDefined()
})

test('a folder only read, then an Edit into it: generates', async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on)
  await start($)
  await bash($, 'git -C /w/app log -1')
  await edit($)
  await turnEnd($)
  await clock.advance(3_000)
  expect(w.models).toHaveLength(1)
})

test('an Edit by a subagent registers its folder; the main turn end generates', async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on)
  await start($)
  await $.tool.call({ tool: 'Edit', tool_use_id: 't3', file_path: '/w/app/src/a.ts', agentId: 'ag1' } as never)
  await turnEnd($, 'ag1')
  await clock.advance(3_000)
  expect(w.models).toEqual([]) // never on an agent's turn end
  await turnEnd($)
  await clock.advance(3_000)
  expect(w.models).toHaveLength(1)
})

test('a Write into a folder that does not exist yet: its repo gets a slot', async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on, { missing: ['/w/app/docs/new'] })
  await start($)
  await $.tool.call({ tool: 'Write', tool_use_id: 't4', file_path: '/w/app/docs/new/x.md' } as never)
  await turnEnd($)
  await clock.advance(3_000)
  expect(slotsOf(w).map(s => s.root)).toEqual(['/w/app'])
  expect(w.models).toHaveLength(1)
})

test('the store keeps no hunk code; the pane still has it', async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on)
  await start($)
  await edit($)
  await turnEnd($)
  await clock.advance(3_000)
  expect(slotsOf(w)[0]!.review!.files[0]!.changes[0]!.text).toBe('')
  const ui = await $.ui.mount({ plugin: 'intent', surface: 'desktop', ...PANE } as never)
  expect(await ui.find({ key: 'code-0-0' })).toBeDefined()
})

test('after a resume, the next pass brings the code back from the diff, without a model call', async ($, on) => {
  const clock = mock.clock(on, { now: DAY })
  const review = {
    source: { kind: 'conversation', repo: '/w/app', ref: 'mb1' }, diffHash: hashText(diffOf('added')), summary: 'Résumé', intentions: [],
    files: [{ path: 'src/a.ts', role: 'Rôle', importance: 'key', status: 'modified', changes: [{ hunk: HUNK, lines: [1, 3], intention: null, explanation: 'Ajoute a', text: '' }] }],
    skipped: [], generatedAt: '2026-10-17T10:00:00.000Z',
  }
  const saved: Slot = { ...INTERRUPTED, status: 'idle', diffHash: review.diffHash, review: review as Slot['review'] }
  const w = engine(on, { store: new Map([['session:me', { updatedAt: DAY, slots: [saved] }]]) })
  await start($)
  const before = await $.ui.mount({ plugin: 'intent', surface: 'desktop', ...PANE } as never)
  expect(await before.find({ key: 'code-0-0' })).toBeUndefined() // no code to show yet
  await before.unmount()
  await turnEnd($)
  await clock.advance(3_000)
  expect(w.models).toEqual([])
  const after = await $.ui.mount({ plugin: 'intent', surface: 'desktop', ...PANE } as never)
  expect(await after.find({ key: 'code-0-0' })).toBeDefined()
})

test('a refused write makes room: the oldest session goes, then one more try', async ($, on) => {
  const clock = mock.clock(on, { now: 30 * DAY })
  const store = new Map<string, unknown>([
    ['session:b', { updatedAt: 20 * DAY, slots: [] }],
    ['session:a', { updatedAt: 10 * DAY, slots: [] }],
  ])
  const w = engine(on, { store, refusedSets: 1 })
  await start($)
  await edit($)
  await turnEnd($)
  await clock.advance(3_000)
  expect(w.store.has('session:a')).toBe(false)
  expect(w.store.has('session:b')).toBe(true)
  expect(w.store.has('session:me')).toBe(true)
})

test('a git pull on a feature branch keeps the start and clears the reset', async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on)
  await start($)
  await edit($)
  await bash($, 'git pull')
  expect(slotsOf(w)[0]!.resetStart).toBe(true)
  await turnEnd($)
  await clock.advance(3_000)
  expect(slotsOf(w)[0]).toMatchObject({ resetStart: false, start: 'h0' })
})

// The review page: its server simulated by `process.spawn`, whose output the test writes.
// A server held open slows each settle down to about a second: only the tests that talk to a running server hold it.
const DIR = '/Users/me/.claude-mods/intent/me'
const TOKEN = 'ab'.repeat(16)
const argOf = (argv: string[] | undefined, flag: string) => argv?.[argv.indexOf(flag) + 1]
const end = ($: Engine) => $.session.end({ reason: 'other', sessionId: 'me', resume: { id: 'me' } } as never)

test('first awake slot starts the server and shows its link', async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on, { python: true })
  await start($)
  await turnEnd($)
  await clock.advance(3_000)
  expect(w.spawns).toEqual([]) // the session's own folder, only read: no page yet
  await edit($)
  expect(w.spawns).toEqual([]) // never from the tool call itself: an interrupted call would kill the server
  await turnEnd($)
  await clock.advance(3_000)
  expect(w.spawns).toHaveLength(1)
  const argv = w.spawns[0]!
  expect(argv[0]).toBe('/usr/bin/python3')
  expect(argv[1]).toMatch(/\/server\/serve\.py$/)
  expect(argOf(argv, '--dir')).toBe(DIR)
  expect(argOf(argv, '--port')).toBe('0')
  const token = argOf(argv, '--token')!
  expect(token).toMatch(/^[0-9a-f]{32}$/)
  expect(w.pages[0]).toEqual({ url: `http://127.0.0.1:4312/?t=${token}`, port: 4312, token })
  // This server stopped after its pieces: the page cannot run, and the next turn does not try again.
  expect(w.state.get('page')).toEqual({ error: 'stopped' })
  await turnEnd($)
  await clock.advance(3_000)
  expect(w.spawns).toHaveLength(1)
})

test('python missing: page error, no spawn, no retry at the next turn', async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on)
  const lookups = () => w.runs.filter(line => / -c import sys/.test(line)).length
  await start($)
  await edit($)
  await turnEnd($)
  await clock.advance(3_000)
  expect(w.state.get('page')).toEqual({ error: 'python' })
  expect(w.spawns).toEqual([])
  const tried = lookups()
  expect(tried).toBeGreaterThan(0)
  w.diff = diffOf('changed')
  await turnEnd($)
  await clock.advance(3_000)
  expect(lookups()).toBe(tried)
  // /intent tries again.
  w.python = true
  await $.command.run({ command: 'intent', args: '' } as never)
  await clock.advance(0)
  expect(w.spawns).toHaveLength(1)
  expect(w.pages).toContainEqual(expect.objectContaining({ port: 4312 }))
})

test('an ask line sends the question once, to the model', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on, { python: true })
  await start($)
  await edit($)
  await turnEnd($)
  await clock.advance(3_000)
  expect(w.state.get('page')).toEqual({ error: 'stopped' }) // that first server stopped after its pieces
  // /intent starts another, which writes the questions once the review is there; a blank free question is not sent.
  const ask = `${JSON.stringify({ type: 'ask', kind: 'here', root: '/w/app', path: 'src/a.ts', hunk: HUNK, text: null })}\n`
  w.server = [ask, ask, `${JSON.stringify({ type: 'ask', kind: 'free', root: '/w/app', text: '  ' })}\n`]
  await $.command.run({ command: 'intent', args: '' } as never)
  await clock.advance(0)
  expect(w.spawns).toHaveLength(2)
  const file = slotsOf(w)[0]!.review!.files[0]!
  expect(w.submitted).toEqual([])
  expect(questions(w)).toHaveLength(1)
  expect(answersOf(w)).toEqual([expect.objectContaining({ kind: 'here', question: hereQuestion(texts('fr'), '/w/app', file, file.changes[0]!) })])
})

test('selection ask from the page', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on, { python: true })
  await start($)
  await edit($)
  await turnEnd($)
  await clock.advance(3_000)
  const selection = { type: 'ask', kind: 'selection', root: '/w/app', path: 'src/a.ts', from: 4, to: 6, text: 'const b = 2' }
  w.server = [`${JSON.stringify(selection)}\n`]
  await $.command.run({ command: 'intent', args: '' } as never)
  await clock.advance(0)
  expect(w.submitted).toEqual([])
  expect(questions(w)).toHaveLength(1)
  const { prompt } = questions(w)[0]!
  expect(prompt).toContain('Lines: 4-6')
  expect(prompt).toContain('const b = 2')
  expect(prompt).toContain('<file>\n')
  expect(prompt).toContain(selectionQuestion(texts('fr'), '/w/app', 'src/a.ts', 4, 6))
  // Answered at once here: the store keeps no excerpt of a finished answer; the pane's slots do.
  expect((w.state.get('slots') as Slot[])[0]!.answers).toEqual([expect.objectContaining({ kind: 'selection', path: 'src/a.ts', lines: [4, 6], excerpt: 'const b = 2', status: 'done' })])
  expect(answersOf(w)[0]).not.toHaveProperty('excerpt')
})

test('a viewer line counts as an open pane', async ($, on) => {
  // Closed by hand before a reload: the restored state says so. The page says it is open as its server starts.
  const clock = mock.clock(on)
  const w = engine(on, { python: true, server: ['{"type":"ready","port":4312}\n{"type":"viewer"}\n'], restored: new Map([['paneClosed', true]]) })
  await start($)
  await edit($)
  await turnEnd($)
  await clock.advance(3_000)
  expect(w.models).toHaveLength(1)
  // 25 s later without a signal, with the pane still closed: behind again.
  await clock.advance(30_000)
  w.diff = diffOf('changed')
  await turnEnd($)
  await clock.advance(3_000)
  expect(w.models).toHaveLength(1)
  expect(slotsOf(w)[0]!.status).toBe('stale')
})

test('review.json is written after a review', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on, { python: true, serverHolds: true })
  await start($)
  await edit($)
  await turnEnd($)
  await clock.advance(3_000)
  const [path, text] = w.writes[w.writes.length - 1]!
  expect(path).toMatch(new RegExp(`^${DIR}/review\\.json\\.tmp-\\d+$`))
  expect(w.runs).toContain(`mv -f ${path} ${DIR}/review.json`)
  const data = JSON.parse(text)
  expect(data).toMatchObject({ lang: 'fr', publish: false, published: {} })
  expect(data.reviews[0]).toMatchObject({ root: '/w/app', branch: 'feat/x', summary: 'Résumé' })
  expect(w.runs.filter(line => / diff .*-U10 /.test(line))).toHaveLength(1) // the wide diff once per review
  await end($)
})

test('no server running: no review.json', async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on)
  await start($)
  await edit($)
  await turnEnd($)
  await clock.advance(3_000)
  expect(w.state.get('page')).toEqual({ error: 'python' })
  expect(slotsOf(w)[0]!.review?.summary).toBe('Résumé')
  expect(w.writes).toEqual([])
})

test('a reload reuses the port and token', async ($, on) => {
  const clock = mock.clock(on)
  const kept = { url: `http://127.0.0.1:4312/?t=${TOKEN}`, port: 4312, token: TOKEN }
  const w = engine(on, { python: true, server: ['{"type":"ready","port":5000}\n'], restored: new Map([['page', kept]]) })
  await start($)
  await edit($)
  await turnEnd($)
  await clock.advance(3_000)
  expect(argOf(w.spawns[0], '--port')).toBe('4312')
  expect(argOf(w.spawns[0], '--token')).toBe(TOKEN)
  // The port was taken: the link follows the one the server found.
  expect(w.pages[0]).toEqual({ url: `http://127.0.0.1:5000/?t=${TOKEN}`, port: 5000, token: TOKEN })
})

test('old session folders go at the start; at the end the server stops and this folder goes; a resume starts another', async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on, { python: true, serverHolds: true })
  await start($)
  expect(w.runs).toContain('find /Users/me/.claude-mods/intent -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +')
  await edit($)
  await turnEnd($)
  await clock.advance(3_000)
  await end($)
  await clock.advance(0)
  expect(w.stopped).toBe(true)
  expect(w.runs).toContain(`rm -rf ${DIR}`)
  expect(w.state.get('page')).toBeNull()
  // A resume starts the session again: it gets its own server.
  w.serverHolds = false
  await start($)
  w.diff = diffOf('changed')
  await turnEnd($)
  await clock.advance(3_000)
  expect(w.spawns).toHaveLength(2)
})

test('no interface: no python, no spawn, no file', async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on, { python: true, surfaces: [] })
  await start($)
  await edit($)
  await turnEnd($)
  await clock.advance(5_000)
  await end($)
  expect(w.runs).toEqual([])
  expect(w.spawns).toEqual([])
  expect(w.writes).toEqual([])
})

/** The last review.json written. */
const lastData = (w: World) => JSON.parse([...w.writes].reverse().find(([path]) => /review\.json\.tmp-/.test(path))![1])
const PUBLISH = `${JSON.stringify({ type: 'publish', root: '/w/app' })}\n`

/** A review shown with its page server running (held until the session ends). */
async function withPage($: Engine, on: On, world: Partial<World> = {}) {
  const clock = mock.clock(on)
  const w = engine(on, { python: true, serverHolds: true, ...world })
  await start($)
  await edit($)
  await turnEnd($)
  await clock.advance(3_000)
  return { w, clock }
}

test('the pane is a remote when the page runs', { options: { language: 'fr' } }, async ($, on) => {
  const { w } = await withPage($, on)
  const ui = await $.ui.mount({ plugin: 'intent', surface: 'desktop', ...PANE } as never)
  // Read once: each read waits for the running server to settle.
  const drawn = (await ui.findAll({})).map(el => ({ type: el.type, key: el.key, text: el.text }))
  expect(drawn).toContainEqual({ type: 'Button', key: 'open-review', text: 'Ouvrir la revue' })
  expect(drawn).toContainEqual(expect.objectContaining({ type: 'Text', text: 'Résumé' }))
  // Compact: the status and « Ouvrir la revue » on top, the files as a count.
  const at = (match: (el: (typeof drawn)[number]) => boolean) => drawn.findIndex(match)
  expect(at(el => el.key === 'open-review')).toBeLessThan(at(el => el.text === 'Résumé'))
  expect(drawn).toContainEqual(expect.objectContaining({ type: 'Text', text: '1 fichier · voir dans la revue' }))
  expect(drawn).not.toContainEqual(expect.objectContaining({ type: 'Text', text: 'src/a.ts' }))
  // The branch of each folder, for the folder picker.
  expect(w.state.get('branches')).toEqual({ '/w/app': 'feat/x' })
  // The code and the questions live in the page now.
  expect(drawn.filter(el => el.type === 'Code' || el.type === 'Input' || /^(code|here|ask)-/.test(el.key ?? ''))).toEqual([])
  await ui.press({ key: 'open-review' })
  const token = argOf(w.spawns[0], '--token')
  expect(w.runs).toContain(`open http://127.0.0.1:4312/?t=${token}`)
  expect(w.spawns).toHaveLength(1) // running and ready: opened at once
  await end($)
})

test('the pane keeps the step-1 view when python is missing', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  await start($)
  await edit($)
  await turnEnd($)
  await clock.advance(3_000)
  const ui = await $.ui.mount({ plugin: 'intent', surface: 'desktop', ...PANE } as never)
  expect(await ui.find({ type: 'Text', text: texts('fr').page.error.python })).toBeDefined()
  expect(await ui.find({ key: 'code-0-0' })).toBeDefined()
  expect(await ui.find({ key: 'open-review' })).toBeUndefined()
  // No questions without the page.
  expect((await ui.findAll({})).filter(el => el.type === 'Input' || /^(here|ask)-/.test(el.key ?? ''))).toEqual([])
})

/** The pane as drawn now, from a mount of its own. */
const paneNow = async ($: Engine) => {
  const ui = await $.ui.mount({ plugin: 'intent', surface: 'desktop', ...PANE } as never)
  const drawn = await drawnOf(ui)
  await ui.unmount()
  return drawn
}
const opens = (w: World) => w.runs.filter(line => line.startsWith('open '))
const READY = '{"type":"ready","port":4312}\n'
const KEPT = { url: `http://127.0.0.1:4312/?t=${TOKEN}`, port: 4312, token: TOKEN }

/** After a reload: a review resumed and the page's address kept, but no server in this module (one held, silent until the test speaks). */
async function keptPage($: Engine, on: On) {
  const clock = mock.clock(on)
  const w = engine(on, {
    python: true, serverHolds: true, server: [], restored: new Map([['page', KEPT]]),
    store: new Map([['session:me', { updatedAt: 0, slots: [{ ...INTERRUPTED, status: 'idle' }] }]]),
  })
  await start($)
  return { w, clock }
}

test('« Ouvrir la revue » on a page down after a reload: started with the kept port and token, « Ouverture… » meanwhile, opened once ready', { options: { language: 'fr' } }, async ($, on) => {
  const { w, clock } = await keptPage($, on)
  const ui = await $.ui.mount({ plugin: 'intent', surface: 'desktop', ...PANE } as never)
  await ui.press({ key: 'open-review' })
  await ui.unmount()
  await clock.advance(0)
  expect(w.spawns).toHaveLength(1)
  expect(argOf(w.spawns[0], '--port')).toBe('4312')
  expect(argOf(w.spawns[0], '--token')).toBe(TOKEN)
  const during = await paneNow($)
  expect(during).toContainEqual(expect.objectContaining({ type: 'Text', text: texts('fr').opening }))
  expect(during).not.toContainEqual(expect.objectContaining({ key: 'open-review' }))
  expect(opens(w)).toEqual([])
  w.say(READY)
  await clock.advance(0)
  expect(opens(w)).toEqual([`open ${KEPT.url}`])
  const after = await paneNow($)
  expect(after).toContainEqual(expect.objectContaining({ key: 'open-review' }))
  expect(after).not.toContainEqual(expect.objectContaining({ text: texts('fr').opening }))
  expect(w.state.get('opening')).toBe(false)
  await end($)
})

test('a double press while the page starts: one server, one open', async ($, on) => {
  const { w, clock } = await keptPage($, on)
  const ui = await $.ui.mount({ plugin: 'intent', surface: 'desktop', ...PANE } as never)
  await Promise.all([ui.press({ key: 'open-review' }), ui.press({ key: 'open-review' })])
  await ui.unmount()
  await clock.advance(0)
  w.say(READY)
  await clock.advance(0)
  expect(w.spawns).toHaveLength(1)
  expect(opens(w)).toEqual([`open ${KEPT.url}`])
  await end($)
})

test('a server not ready within 10 s: nothing opens, the opening goes, the pane says the page did not start', { options: { language: 'fr' } }, async ($, on) => {
  const { w, clock } = await keptPage($, on)
  const ui = await $.ui.mount({ plugin: 'intent', surface: 'desktop', ...PANE } as never)
  await ui.press({ key: 'open-review' })
  await ui.unmount()
  await clock.advance(0)
  expect(w.spawns).toHaveLength(1)
  await clock.advance(10_000)
  await clock.advance(0)
  expect(opens(w)).toEqual([])
  expect(w.stopped).toBe(true)
  expect(w.state.get('opening')).toBe(false)
  expect(w.state.get('page')).toEqual({ error: 'start' })
  const drawn = await paneNow($)
  expect(drawn).toContainEqual(expect.objectContaining({ type: 'Text', text: texts('fr').page.error.start }))
  expect(drawn).toContainEqual(expect.objectContaining({ key: 'open-review' })) // it can be tried again
})

test('a stopped page: the step-1 view offers « Ouvrir la revue », which starts it again and opens it', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on, { python: true })
  await start($)
  await edit($)
  await turnEnd($)
  await clock.advance(3_000)
  expect(w.state.get('page')).toEqual({ error: 'stopped' })
  const ui = await $.ui.mount({ plugin: 'intent', surface: 'desktop', ...PANE } as never)
  expect(await ui.find({ type: 'Text', text: texts('fr').page.error.stopped })).toBeDefined()
  expect(await ui.find({ key: 'code-0-0' })).toBeDefined()
  w.serverHolds = true
  await ui.press({ key: 'open-review' })
  await ui.unmount()
  await clock.advance(0)
  expect(w.spawns).toHaveLength(2)
  expect(opens(w)).toEqual([`open http://127.0.0.1:4312/?t=${argOf(w.spawns[1], '--token')}`])
  await end($)
})

test('publish calls the Artifact tool once and keeps the link', { options: { language: 'fr' } }, async ($, on) => {
  const { w, clock } = await withPage($, on, { tools: ['Artifact'] })
  expect(lastData(w)).toMatchObject({ publish: true, published: {} })
  w.say(PUBLISH + PUBLISH) // a double press: one publish
  await clock.advance(0)
  expect(w.artifacts).toHaveLength(1)
  expect(w.artifacts[0]).toMatchObject({ tool: 'Artifact', file_path: `${DIR}/publish-app-feat-x.html`, icon: 'code', consent: texts('fr').page.publishConsent })
  expect(w.artifacts[0]!.url).toBeUndefined()
  const [, html] = w.writes.find(([path]) => path === `${DIR}/publish-app-feat-x.html`)!
  expect(html).toContain('"readonly":true')
  expect(html).not.toContain('<input')
  expect(w.store.get('published:/w/app|feat/x')).toBe(ARTIFACT)
  expect(lastData(w).published).toEqual({ '/w/app': ARTIFACT })
  // Again on the same branch: the same artifact, updated.
  w.say(PUBLISH)
  await clock.advance(0)
  expect(w.artifacts).toHaveLength(2)
  expect(w.artifacts[1]!.url).toBe(ARTIFACT)
  // The pane shows the link; a press opens it.
  const ui = await $.ui.mount({ plugin: 'intent', surface: 'desktop', ...PANE } as never)
  await ui.press({ key: 'open-artifact' })
  expect(w.runs).toContain(`open ${ARTIFACT}`)
  await end($)
})

test('a stored address another conversation published: refused, then published anew without it, and the new one kept', async ($, on) => {
  const refused = { ref: 'r', result: 'not published in this conversation', text: 'not published in this conversation', isError: true }
  const fresh = { ref: 'r', result: { url: 'https://claude.ai/artifact/new', path: '/x' }, text: '' }
  const { w, clock } = await withPage($, on, { tools: ['Artifact'], artifactReplies: [refused, fresh] })
  w.store.set('published:/w/app|feat/x', ARTIFACT)
  w.say(PUBLISH)
  await clock.advance(0)
  expect(w.artifacts.map(a => [a.file_path, a.url])).toEqual([[`${DIR}/publish-app-feat-x.html`, ARTIFACT], [`${DIR}/publish-app-feat-x.html`, undefined]])
  expect(w.store.get('published:/w/app|feat/x')).toBe('https://claude.ai/artifact/new')
  expect(lastData(w).published).toEqual({ '/w/app': 'https://claude.ai/artifact/new' })
  await end($)
})

test('a refused location: published from .git/info, else the page says it failed', { options: { language: 'fr' } }, async ($, on) => {
  const refused = { ref: 'r', result: 'outside the working directory', text: 'outside the working directory', isError: true }
  const { w, clock } = await withPage($, on, { tools: ['Artifact'], artifactReplies: [refused] })
  w.say(PUBLISH)
  await clock.advance(0)
  expect(w.artifacts.map(a => a.file_path)).toEqual([`${DIR}/publish-app-feat-x.html`, '/w/app/.git/info/intent-publish-app-feat-x.html'])
  expect(w.writes.map(([path]) => path)).toContain('/w/app/.git/info/intent-publish-app-feat-x.html')
  expect(lastData(w).published).toEqual({ '/w/app': ARTIFACT })
  // Now with a stored address: with it, then without it, then from .git/info, all refused.
  w.artifactReplies.push(refused, refused, refused)
  w.say(PUBLISH)
  await clock.advance(0)
  expect(w.artifacts.slice(2).map(a => [a.file_path, a.url]))
    .toEqual([[`${DIR}/publish-app-feat-x.html`, ARTIFACT], [`${DIR}/publish-app-feat-x.html`, undefined], ['/w/app/.git/info/intent-publish-app-feat-x.html', undefined]])
  expect(lastData(w).publishFailed).toEqual({ '/w/app': 'Publication impossible (refusée)' })
  await end($)
})

test('no Artifact tool: no publish button in the page data', async ($, on) => {
  const { w, clock } = await withPage($, on)
  expect(lastData(w)).toMatchObject({ publish: false, published: {} })
  w.say(PUBLISH)
  await clock.advance(0)
  expect(w.artifacts).toEqual([])
  await end($)
})

// The conversation's PRs: a link in the conversation, the review of a PR from the page, a resume.
const PR_ROOT = 'pr:acme/app#12'
const PR_LINK = 'https://github.com/acme/app/pull/12'
const PR_INFO = { number: 12, title: 'Add a', state: 'OPEN', url: PR_LINK, headRefName: 'feat/y', headRefOid: 'head12', baseRefName: 'main', baseRefOid: 'base12' }
const LINKED = [{ role: 'user', text: `regarde ${PR_LINK}`, toolUses: [] }]
const CREATED = [{ role: 'assistant', text: '', toolUses: [{ tool: 'Bash', input: { command: 'gh pr create --fill' }, text: PR_LINK, tool_use_id: 't9' }] }]
/** gh knows PR 12: its info and description, and its diff. Nothing else, no PR of any branch. */
const ghKnowsPr12 = (line: string) =>
  /^gh pr view 12 /.test(line) ? JSON.stringify({ ...PR_INFO, body: 'Pourquoi', commits: [{ messageHeadline: 'feat: a' }] })
    : /^gh pr diff 12 /.test(line) ? diffOf('added') : null
/** What the PRs ask gh (a folder's base lookup, from before the PRs, is not theirs). */
const ghRuns = (w: World) => w.runs.filter(line => /^gh /.test(line) && !/ -q \.baseRefName$/.test(line))
const gitDiffs = (w: World) => w.runs.filter(line => /^git .* diff /.test(line)).length
const refreshLine = (root: string) => `${JSON.stringify({ type: 'refresh', root })}\n`
const savedPrs = (w: World) => (w.store.get('session:me') as Saved | undefined)?.prs

test('a PR link in the conversation lists the PR', async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on, { messages: LINKED, gh: ghKnowsPr12 })
  await start($)
  await edit($)
  await turnEnd($)
  await clock.advance(3_000)
  expect(w.state.get('prs')).toMatchObject([{ ref: { slug: 'acme/app', number: 12 }, opened: false, unreachable: false, info: { title: 'Add a', state: 'open', headRefOid: 'head12' } }])
  expect(savedPrs(w)).toEqual(w.state.get('prs')) // kept with the session
  expect(w.models).toHaveLength(1) // the folder's review only: a PR is reviewed on a click
})

test('nothing asked to gh while nothing is watched', async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on, { messages: LINKED, gh: ghKnowsPr12, restored: new Map([['paneClosed', true]]) })
  await start($)
  await edit($)
  await turnEnd($)
  await clock.advance(3_000)
  expect(w.state.get('prs')).toMatchObject([{ ref: { number: 12 }, info: null, checkedAt: null }]) // listed, not asked
  expect(ghRuns(w)).toEqual([])
})

test('a refresh on a pr root reviews the PR, never the folders', async ($, on) => {
  const { w, clock } = await withPage($, on, { messages: LINKED, gh: ghKnowsPr12 })
  const [diffs, models] = [gitDiffs(w), w.models.length]
  w.say(refreshLine(PR_ROOT))
  await clock.advance(0)
  expect(slotsOf(w).find(s => s.root === PR_ROOT)).toMatchObject({
    name: '#12', status: 'idle', pr: { slug: 'acme/app', number: 12, head: 'head12', clone: '/w/app', narrow: true }, review: { source: { kind: 'pr' }, summary: 'Résumé' },
  })
  expect(w.models).toHaveLength(models + 1)
  expect(gitDiffs(w)).toBe(diffs)
  expect(slotsOf(w).find(s => s.root === '/w/app')).toMatchObject({ status: 'idle' })
  // The page is told: its header, its branch.
  const data = JSON.parse(w.writes.filter(([path]) => /review\.json\.tmp/.test(path)).at(-1)![1])
  expect(data.reviews.find((r: { root: string }) => r.root === PR_ROOT)).toMatchObject({ branch: 'feat/y', pr: { number: 12, title: 'Add a', state: 'open', url: PR_LINK, narrow: true } })
  await end($)
})

test('a refresh on a folder only read wakes it and reviews it', async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on, { python: true, serverHolds: true })
  await start($)
  await turnEnd($)
  await clock.advance(3_000)
  expect(slotsOf(w)).toEqual([]) // nothing awake, so no slot is shown, none saved
  expect(w.models).toEqual([])
  await $.tool.call({ tool: 'Edit', tool_use_id: 't3', file_path: '/w/other/src/a.ts' } as never)
  await turnEnd($)
  await clock.advance(3_000)
  expect(slotsOf(w).map(s => [s.root, s.dormant === null])).toEqual([['/w/app', false], ['/w/other', true]])
  expect(w.models).toHaveLength(1)
  w.say(refreshLine('/w/app'))
  await clock.advance(0)
  expect(slotsOf(w).map(s => [s.root, s.dormant === null, s.status])).toEqual([['/w/app', true, 'idle'], ['/w/other', true, 'idle']])
  expect(w.models).toHaveLength(2)
  await end($)
})

test('the main conversation gets nothing: no prompt, no agent, however many PRs', async ($, on) => {
  const { w, clock } = await withPage($, on, { messages: [...LINKED, ...CREATED], gh: ghKnowsPr12 })
  w.say(refreshLine(PR_ROOT))
  await clock.advance(0)
  expect(slotsOf(w).find(s => s.root === PR_ROOT)?.review).not.toBeNull()
  expect(w.submitted).toEqual([])
  expect(w.agents).toEqual([])
  await end($)
})

test('a question on a PR slot reads the file at the PR head, from its clone', async ($, on) => {
  const { w, clock } = await withPage($, on, { messages: LINKED, gh: ghKnowsPr12 })
  w.say(refreshLine(PR_ROOT))
  await clock.advance(0)
  w.say(`${JSON.stringify({ type: 'ask', kind: 'here', root: PR_ROOT, path: 'src/a.ts', hunk: HUNK, text: null })}\n`)
  await clock.advance(0)
  expect(w.runs).toContain('git -C /w/app show head12:src/a.ts')
  expect(questions(w)).toHaveLength(1)
  expect(questions(w)[0]!.prompt).toContain('<file>\n1: function a() {')
  await end($)
})

/** gh knows PR 12 and PR 13 (the first one created here, the second one only linked). */
const ghKnowsBoth = (line: string) =>
  /^gh pr view 13 /.test(line) ? JSON.stringify({ ...PR_INFO, number: 13, title: 'Other', url: 'https://github.com/acme/app/pull/13', headRefOid: 'head13' }) : ghKnowsPr12(line)
const LINKED_13 = [{ role: 'user', text: 'regarde https://github.com/acme/app/pull/13', toolUses: [] }]

test('the pane lists this conversation\'s PRs, then the viewed ones', { options: { language: 'fr' } }, async ($, on) => {
  const { w, clock } = await withPage($, on, { messages: [...CREATED, ...LINKED_13], gh: ghKnowsBoth })
  const drawn = await paneNow($)
  const at = (text: string) => drawn.findIndex(el => el.text === text)
  const fr = texts('fr').prs
  expect(at(fr.heading)).toBeGreaterThan(-1)
  expect(at(fr.heading)).toBeLessThan(at('#12 Add a · ouverte · à revoir'))
  expect(at('#12 Add a · ouverte · à revoir')).toBeLessThan(at(fr.viewedHeading))
  expect(at(fr.viewedHeading)).toBeLessThan(at('#13 Other · ouverte · à revoir'))
  expect(drawn.filter(el => el.type === 'Button' && el.text === fr.open)).toHaveLength(2)
  await end($)
})

test('a reviewed PR slot is never a folder of the picker, and the pane shows it reviewed', { options: { language: 'fr' } }, async ($, on) => {
  const { w, clock } = await withPage($, on, { messages: CREATED, gh: ghKnowsPr12 })
  w.say(refreshLine(PR_ROOT))
  await clock.advance(0)
  expect(slotsOf(w).some(s => s.root === PR_ROOT)).toBe(true)
  const drawn = await paneNow($)
  expect(drawn.filter(el => el.type === 'Select')).toEqual([])
  expect(drawn).toContainEqual(expect.objectContaining({ type: 'Text', text: '#12 Add a · ouverte' }))
  await end($)
})

test('a group without PR is not drawn', { options: { language: 'fr' } }, async ($, on) => {
  await withPage($, on, { messages: LINKED_13, gh: ghKnowsBoth })
  const drawn = await paneNow($)
  expect(drawn.some(el => el.text === texts('fr').prs.heading)).toBe(false)
  expect(drawn.some(el => el.text === texts('fr').prs.viewedHeading)).toBe(true)
  await end($)
})

test('opening a PR from the pane opens the page on it, and starts its review', async ($, on) => {
  const { w, clock } = await withPage($, on, { messages: LINKED, gh: ghKnowsPr12 })
  const ui = await $.ui.mount({ plugin: 'intent', surface: 'desktop', ...PANE } as never)
  await ui.press({ key: 'open-pr:acme/app#12' })
  await ui.unmount()
  await clock.advance(0)
  const token = argOf(w.spawns[0], '--token')
  expect(opens(w)).toEqual([`open http://127.0.0.1:4312/?t=${token}#source=pr%3Aacme%2Fapp%2312`])
  expect(slotsOf(w).find(s => s.root === PR_ROOT)).toMatchObject({ status: 'idle', review: { source: { kind: 'pr' } } })
  await end($)
})

test('a resumed session finds its PRs and PR reviews again', async ($, on) => {
  const known = { ref: { slug: 'acme/app', number: 12 }, opened: true, fromBranch: false, info: { slug: 'acme/app', ...PR_INFO, state: 'open' }, checkedAt: 5, unreachable: false, folder: null }
  const prSlot: Slot = {
    ...INTERRUPTED, root: PR_ROOT, name: '#12', start: null, status: 'running', review: null,
    pr: { slug: 'acme/app', number: 12, head: 'head12', clone: '/w/app', narrow: false },
  }
  mock.clock(on, { now: DAY })
  const w = engine(on, { store: new Map([['session:me', { updatedAt: DAY, slots: [prSlot], prs: [known] }]]) })
  await start($)
  expect(w.state.get('prs')).toEqual([known])
  expect(w.state.get('slots')).toEqual([{ ...prSlot, status: 'stale' }]) // its review was cut: behind, as a folder's
  expect(w.runs.filter(line => line.includes('pr:'))).toEqual([]) // nothing runs git on a PR root
  await $.command.run({ command: 'intent', args: '' } as never)
  expect(w.runs.filter(line => line.includes('pr:'))).toEqual([])
  expect(savedPrs(w)).toEqual([known])
})

test('a resumed PR review gets its code back at the next watched pass, from its head, without a model call', async ($, on) => {
  const known = { ref: { slug: 'acme/app', number: 12 }, opened: true, fromBranch: false, info: { slug: 'acme/app', ...PR_INFO, state: 'open' }, checkedAt: DAY, unreachable: false, folder: null }
  const change = { hunk: HUNK, lines: [1, 3], intention: null, explanation: 'Ajoute', text: '' } // the store keeps no code
  const review = {
    source: { kind: 'pr', repo: 'acme/app', ref: 'base12' }, diffHash: 'x', summary: 'Résumé', intentions: [], skipped: [], generatedAt: '2026-10-21T00:00:00.000Z',
    files: [{ path: 'src/a.ts', role: '', importance: 'key', status: 'modified', changes: [change] }],
  }
  const prSlot = { ...INTERRUPTED, root: PR_ROOT, name: '#12', start: null, status: 'idle', review, pr: { slug: 'acme/app', number: 12, head: 'head12', clone: '/w/app', narrow: false } }
  const clock = mock.clock(on, { now: DAY })
  const w = engine(on, { messages: [], gh: ghKnowsPr12, store: new Map([['session:me', { updatedAt: DAY, slots: [prSlot], prs: [known] }]]) })
  await start($)
  const textOf = () => (w.state.get('slots') as Slot[]).find(s => s.root === PR_ROOT)!.review!.files[0]!.changes[0]!.text
  expect(textOf()).toBe('')
  await $.command.run({ command: 'intent', args: '' } as never)
  await clock.advance(0)
  expect(textOf()).toContain('added')
  expect(w.models.filter(m => m.prompt.includes('<pr_title>'))).toEqual([]) // the folder's own review is not the PR's
})

test('a session saved before the PRs existed resumes with none', async ($, on) => {
  mock.clock(on, { now: DAY })
  const w = engine(on, { store: new Map([['session:me', { updatedAt: DAY, slots: [{ ...INTERRUPTED, status: 'idle' }] }]]) })
  await start($)
  expect(w.state.get('prs')).toEqual([])
  expect(w.state.get('slots')).toHaveLength(1)
})

test('/intent with a PR link (from another mod too): the page starts, opens on that PR, and reviews it', async ($, on) => {
  const clock = mock.clock(on)
  // Nothing in the conversation links the PR: only the command's argument names it.
  const w = engine(on, { python: true, serverHolds: true, gh: ghKnowsPr12 })
  await start($)
  await $.command.run({ command: 'intent', args: ` ${PR_LINK} ` } as never)
  await clock.advance(0)
  expect(w.spawns).toHaveLength(1)
  w.say(READY)
  await clock.advance(0)
  expect(opens(w)).toEqual([`open http://127.0.0.1:4312/?t=${argOf(w.spawns[0], '--token')}#source=pr%3Aacme%2Fapp%2312`])
  expect(slotsOf(w).find(s => s.root === PR_ROOT)).toMatchObject({ status: 'idle', review: { source: { kind: 'pr' } } })
  expect(w.state.get('prs')).toMatchObject([{ ref: { slug: 'acme/app', number: 12 }, opened: false }]) // a viewed PR
  await end($)
})

test('/intent without a PR link opens nothing on the page', async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on, { python: true, serverHolds: true, gh: ghKnowsPr12 })
  await start($)
  await $.command.run({ command: 'intent', args: 'see github.com/acme/app' } as never)
  await clock.advance(0)
  expect(opens(w)).toEqual([])
  expect(slotsOf(w).some(s => s.root === PR_ROOT)).toBe(false)
  await end($)
})

test('the first « Ouvrir » on a PR with no awake folder and no page yet: the page starts, then opens on the PR', async ($, on) => {
  const clock = mock.clock(on)
  const w = engine(on, { python: true, serverHolds: true, messages: LINKED, gh: ghKnowsPr12 })
  await start($)
  await turnEnd($)
  await clock.advance(3_000)
  expect(slotsOf(w).filter(s => s.dormant === null)).toEqual([]) // no folder awake
  expect(w.spawns).toEqual([]) // and no page
  const ui = await $.ui.mount({ plugin: 'intent', surface: 'desktop', ...PANE } as never)
  await ui.press({ key: 'open-pr:acme/app#12' })
  await ui.unmount()
  await clock.advance(0)
  expect(w.spawns).toHaveLength(1)
  w.say(READY)
  await clock.advance(0)
  expect(opens(w)).toEqual([`open http://127.0.0.1:4312/?t=${argOf(w.spawns[0], '--token')}#source=pr%3Aacme%2Fapp%2312`])
  await end($)
})
