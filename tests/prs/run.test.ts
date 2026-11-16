// The PRs of a session around a fake host and a counted model: what is asked to gh, when, and the review of one PR.
import { expect, test } from 'claude-code/testing'
import type { ConversationMessage } from '../../hooks/github/links'
import { texts } from '../../hooks/i18n'
import type { KnownPr, Review, Slot } from '../../hooks/model'
import { groupOf } from '../../hooks/prs/known'
import { notePrs, openPr, type PrIO } from '../../hooks/prs/run'
import type { Complete } from '../../hooks/review/generate'
import { newSlot } from '../../hooks/review/slots'
import { storable } from '../../hooks/review/stored'
import { fakeHost } from '../helpers/fake-host'

const ID = 'pr:a/b#7'
const KEY = 'pr:a/b#7@head1'
const HUNK = '@@ -1 +1 @@'
const DIFF = `diff --git a/a.ts b/a.ts\nindex 1..2 100644\n--- a/a.ts\n+++ b/a.ts\n${HUNK}\n-x\n+y\n`
const REPLY = JSON.stringify({
  summary: 'Résumé',
  intentions: [{ id: 1, title: 'T1', why: 'W1', origin: 'conversation' }],
  files: [{ path: 'a.ts', role: 'Rôle', importance: 'key', status: 'modified', changes: [{ hunk: HUNK, lines: [1, 1], intention: 1, explanation: 'Remplace x' }] }],
})
const pr = (number: number, head: string, branch = 'feat/x') => ({
  number, title: `PR ${number}`, state: 'OPEN', url: `https://github.com/a/b/pull/${number}`,
  headRefName: branch, headRefOid: head, baseRefName: 'main', baseRefOid: 'base1',
})
const LINK: ConversationMessage = { role: 'user', text: 'regarde https://github.com/a/b/pull/7', toolUses: [] }
const CREATED: ConversationMessage = {
  role: 'assistant', text: '',
  toolUses: [{ tool: 'Bash', input: { command: 'gh pr create --fill' }, text: 'https://github.com/a/b/pull/7', tool_use_id: 't1' }],
}
const folder = (root: string, extra: Partial<Slot> = {}): Slot => ({ ...newSlot(root, { start: 's0', preexisting: [] }), ...extra })

type Options = {
  messages?: ConversationMessage[]
  slots?: Slot[]
  known?: KnownPr[]
  /** Branch by folder root; every folder points at a/b unless its root says /other. */
  branches?: Record<string, string>
  /** The PR of a folder's branch, by root. */
  branchPrs?: Record<string, ReturnType<typeof pr>>
  ghDown?: boolean
  hold?: boolean
}

function world(options: Options = {}) {
  const w = {
    head: 'head1',
    slots: options.slots ?? [folder('/w/tree')],
    known: options.known ?? [],
    slotWrites: 0,
    knownWrites: 0,
    requests: [] as Parameters<Complete>[0][],
    release: [] as (() => void)[],
  }
  const branches = options.branches ?? { '/w/tree': 'feat/x' }
  const { host, calls, store, state } = fakeHost([
    ...(options.ghDown ? ([[/^gh /, { exitCode: 1, stderr: 'HTTP 404' }]] as [RegExp, never][]) : []),
    [/^gh pr view 7 --json \S*body/, () => ({ stdout: JSON.stringify({ ...pr(7, w.head), body: 'Pourquoi', commits: [{ messageHeadline: 'feat: x' }] }) })],
    [/^gh pr view (\d+) --json/, argv => ({ stdout: JSON.stringify(pr(Number(argv[3]), w.head)) })],
    // The PR of a folder's branch is answered by the folder the call runs in.
    [/^gh pr view --json/, (_argv, run) => {
      const found = run?.cwd ? options.branchPrs?.[run.cwd] : undefined
      return found ? { stdout: JSON.stringify(found) } : { exitCode: 1 }
    }],
    [/^gh pr diff 7 -R a\/b$/, { stdout: DIFF }],
    [/remote get-url origin$/, argv => ({ stdout: argv[2]!.startsWith('/other') ? 'git@github.com:c/d.git\n' : 'git@github.com:a/b.git\n' })],
    [/rev-parse --abbrev-ref HEAD$/, argv => (branches[argv[2]!] ? { stdout: `${branches[argv[2]!]}\n` } : { exitCode: 128 })],
  ] as [RegExp, never][], 1_000_000)
  const complete: Complete = request => {
    w.requests.push(request)
    if (!options.hold) return Promise.resolve({ text: REPLY })
    return new Promise(resolve => w.release.push(() => resolve({ text: REPLY })))
  }
  const io: PrIO = {
    host,
    t: texts('fr'),
    slots: () => w.slots,
    setSlots: async slots => void ((w.slots = slots), w.slotWrites++),
    known: () => w.known,
    setKnown: async known => void ((w.known = known), w.knownWrites++),
    messages: async () => options.messages ?? [LINK],
    complete,
    asked: new Map(),
    busy: new Set(),
    slugs: new Map(),
    running: false,
  }
  return { w, io, host, calls, store, clock: state }
}
const ghViews = (calls: { line: string }[]) => calls.filter(c => c.line.startsWith('gh pr view')).map(c => c.line.split(' --json')[0])
const prSlot = (w: { slots: Slot[] }) => w.slots.find(s => s.root === ID)

test('notePrs while nothing is watched: the PR is listed, nothing is asked to gh or git', async () => {
  const { w, io, calls } = world()
  await notePrs(io, false)
  expect(w.known.map(k => k.ref)).toEqual([{ slug: 'a/b', number: 7 }])
  expect(calls).toEqual([])
})

test('notePrs watched: gh pr view of the new PRs only, never of the recent ones; nothing published when nothing changed', async () => {
  const recent: KnownPr = { ref: { slug: 'a/b', number: 8 }, opened: false, fromBranch: false, info: null, checkedAt: 1_000_000 - 60_000, unreachable: false, folder: null }
  const { w, io, calls, clock } = world({ known: [recent], slots: [] })
  await notePrs(io, true)
  expect(ghViews(calls)).toEqual(['gh pr view 7'])
  expect(w.known.find(k => k.ref.number === 7)).toMatchObject({ checkedAt: 1_000_000, info: { title: 'PR 7' } })
  const writes = w.knownWrites
  await notePrs(io, true)
  expect(ghViews(calls)).toEqual(['gh pr view 7'])
  expect(w.knownWrites).toBe(writes)
  clock.now += 300_001
  await notePrs(io, true)
  expect(ghViews(calls)).toEqual(['gh pr view 7', 'gh pr view 8', 'gh pr view 7'])
})

test('notePrs watched: the PR of an awake folder branch, once per 5 minutes per folder and branch, linked to it', async () => {
  const { w, io, calls, clock } = world({
    messages: [],
    slots: [folder('/w/tree'), folder('/w/sleep', { dormant: 'h' }), folder('/w/gone', { gone: true })],
    branches: { '/w/tree': 'feat/x', '/w/sleep': 'feat/y', '/w/gone': 'feat/z' },
    branchPrs: { '/w/tree': pr(9, 'h9'), '/w/sleep': pr(10, 'h10', 'feat/y') },
  })
  await notePrs(io, true)
  expect(ghViews(calls)).toEqual(['gh pr view']) // the awake folder only; its answer is its info, no second call
  expect(w.known).toEqual([expect.objectContaining({ ref: { slug: 'a/b', number: 9 }, fromBranch: true, opened: false, folder: '/w/tree', checkedAt: 1_000_000 })])
  expect(io.slugs.get('/w/tree')).toBe('a/b')
  expect(io.slugs.get('/w/sleep')).toBe('a/b')
  clock.now += 299_000
  await notePrs(io, true)
  expect(ghViews(calls)).toEqual(['gh pr view'])
  clock.now += 2_000
  await notePrs(io, true)
  expect(ghViews(calls)).toEqual(['gh pr view', 'gh pr view']) // the branch answer is fresh info: no gh pr view 9
})

test('notePrs watched: a link whose head is the branch of a dormant folder is linked to it', async () => {
  const { w, io } = world({ slots: [folder('/w/sleep', { dormant: 'h' })], branches: { '/w/sleep': 'feat/x' } })
  await notePrs(io, true)
  expect(w.known[0]).toMatchObject({ folder: '/w/sleep', fromBranch: false })
})

test('notePrs watched: a new headRefOid makes a reviewed PR slot stale, the folders untouched', async () => {
  const { w, io } = world()
  await openPr(io, ID)
  const folders = w.slots.filter(s => s.root !== ID)
  w.head = 'head2'
  w.known = w.known.map(k => ({ ...k, checkedAt: 0 }))
  await notePrs(io, true)
  expect(prSlot(w)).toMatchObject({ status: 'stale', pr: { head: 'head1' } })
  expect(w.slots.filter(s => s.root !== ID)).toEqual(folders)
})

test('openPr the first time: one model call, the review kept under pr:a/b#7@<head> without its code', async () => {
  const { w, io, store } = world()
  await openPr(io, ID)
  expect(w.requests).toHaveLength(1)
  expect(prSlot(w)).toMatchObject({
    root: ID, name: '#7', start: null, preexisting: [], answers: [], status: 'idle', error: null,
    pr: { slug: 'a/b', number: 7, head: 'head1', clone: '/w/tree', narrow: true },
  })
  const review = prSlot(w)!.review!
  expect(review.source).toEqual({ kind: 'pr', repo: 'a/b', ref: 'base1' })
  expect(review.files[0]!.changes[0]!.text).toContain('+y')
  const kept = store.get(KEY) as Review
  expect(kept.summary).toBe('Résumé')
  expect(kept.files[0]!.changes[0]!.text).toBe('')
})

test('openPr again at the same commit: zero model call, the kept review gets its code back', async () => {
  const { w, io } = world()
  await openPr(io, ID)
  w.slots = w.slots.filter(s => s.root !== ID) // a new session
  await openPr(io, ID)
  expect(w.requests).toHaveLength(1)
  expect(prSlot(w)).toMatchObject({ status: 'idle', pr: { head: 'head1' } })
  expect(prSlot(w)!.review!.files[0]!.changes[0]!.text).toContain('+y')
})

test('a PR not opened here: no transcript, every intention inferred', async () => {
  const { w, io } = world()
  await openPr(io, ID)
  expect(w.requests[0]!.prompt).not.toContain('## Conversation excerpt')
  expect(w.requests[0]!.prompt).toContain('<pr_title>')
  expect(prSlot(w)!.review!.intentions.map(i => i.origin)).toEqual(['inferred'])
})

test('a PR opened here: the transcript is sent, the intentions keep their origin', async () => {
  const { w, io } = world({ messages: [LINK, CREATED] })
  await notePrs(io, false)
  await openPr(io, ID)
  expect(w.requests[0]!.prompt).toContain('## Conversation excerpt')
  expect(w.requests[0]!.prompt).toContain('regarde https://github.com/a/b/pull/7')
  expect(prSlot(w)!.review!.intentions.map(i => i.origin)).toEqual(['conversation'])
})

test('gh failing: the PR slot fails with github, the folders untouched, no model call', async () => {
  const before = [folder('/w/tree', { review: { summary: 's' } as Review })]
  const { w, io } = world({ ghDown: true, slots: before })
  await notePrs(io, false)
  await openPr(io, ID)
  expect(prSlot(w)).toMatchObject({ status: 'failed', error: 'github', review: null })
  expect(w.slots.filter(s => s.root !== ID)).toEqual(before)
  expect(w.known[0]).toMatchObject({ unreachable: true })
  expect(w.requests).toEqual([])
})

test('a host that cannot run anything: neither notePrs nor openPr rejects, the PR fails', async () => {
  const { w, io, host } = world()
  host.run = async () => {
    throw new Error('spawn failed')
  }
  await notePrs(io, true)
  await openPr(io, ID)
  expect(prSlot(w)).toMatchObject({ status: 'failed', error: 'github' })
})

test('something throwing before the PR slot exists still leaves the slot, failed: the page has something to show', async () => {
  const { w, io } = world()
  io.setKnown = async () => {
    throw new Error('store refused')
  }
  await openPr(io, ID)
  expect(w.slots.filter(s => s.root === ID)).toHaveLength(1)
  expect(prSlot(w)).toMatchObject({ status: 'failed', error: 'github', pr: { slug: 'a/b', number: 7 } })
  expect(io.busy.has(ID)).toBe(false)
})

test('a model that fails twice: the PR slot fails with model, nothing kept', async () => {
  const { w, io, store } = world()
  io.complete = async () => ({ error: 'overloaded' })
  await openPr(io, ID)
  expect(prSlot(w)).toMatchObject({ status: 'failed', error: 'model' })
  expect(store.has(KEY)).toBe(false)
})

test('two quick clicks: one generation', async () => {
  const { w, io } = world({ hold: true })
  const first = openPr(io, ID)
  const second = openPr(io, ID)
  await second
  for (let n = 0; n < 50 && w.release.length === 0; n++) await new Promise(resolve => setTimeout(resolve, 0))
  expect(prSlot(w)?.status).toBe('running')
  w.release.forEach(release => release())
  await first
  expect(w.requests).toHaveLength(1)
  expect(prSlot(w)?.status).toBe('idle')
})

test('openPr on a folder does nothing', async () => {
  const { w, io, calls } = world()
  const before = w.slots
  await openPr(io, '/w/tree')
  expect(calls).toEqual([])
  expect(w.slots).toBe(before)
})

test('a store write that fails: the review still shows, only the keeping is lost', async () => {
  const { w, io, host } = world()
  host.store.set = async () => {
    throw new Error('4 MiB')
  }
  await openPr(io, ID)
  expect(prSlot(w)).toMatchObject({ status: 'idle' })
  expect(prSlot(w)!.review!.summary).toBe('Résumé')
})

test('past 50 kept PR reviews, the oldest go; the sessions stay', async () => {
  const { io, store } = world()
  // Generated before the fake clock, so the new review is the newest.
  for (let n = 0; n < 50; n++) store.set(`pr:a/b#${100 + n}@h`, { generatedAt: `1970-01-01T00:00:${String(n).padStart(2, '0')}.000Z` })
  store.set('session:x', { updatedAt: 0, slots: [] })
  await openPr(io, ID)
  expect(store.has(KEY)).toBe(true)
  expect(store.has('pr:a/b#100@h')).toBe(false)
  expect(store.has('pr:a/b#101@h')).toBe(true)
  expect(store.has('session:x')).toBe(true)
})

test('the clone: a followed folder of the same repo, the one on the head branch first, dormant ones too', async () => {
  const { w, io, calls } = world({
    slots: [folder('/other'), folder('/w/main'), folder('/w/sleep', { dormant: 'h' })],
    branches: { '/other': 'feat/x', '/w/main': 'main', '/w/sleep': 'feat/x' },
  })
  await openPr(io, ID)
  expect(prSlot(w)!.pr!.clone).toBe('/w/sleep')
  expect(calls.some(c => c.line.startsWith('git -C /w/sleep cat-file'))).toBe(true)
  expect(calls.some(c => c.line.startsWith('git -C /other cat-file'))).toBe(false)
})

test('openPr: a notePrs write while the click reads the clock is not overwritten', async () => {
  const { w, io, host } = world({ slots: [] })
  const other: KnownPr = { ref: { slug: 'a/b', number: 8 }, opened: false, fromBranch: false, info: null, checkedAt: null, unreachable: false, folder: null }
  const now = host.now
  let added = false
  host.now = async () => {
    if (!added) w.known = [...w.known, other] // what a notePrs pass publishes during the await
    added = true
    return now()
  }
  await openPr(io, ID)
  expect(w.known.map(k => k.ref.number).sort()).toEqual([7, 8])
})

test('two overlapping watched notePrs: gh is asked once for the PR', async () => {
  const { io, host, calls } = world({ slots: [] })
  const run = host.run
  let release = () => {}
  const gate = new Promise<void>(resolve => (release = resolve))
  host.run = async (argv, options) => {
    const result = await run(argv, options)
    if (argv[0] === 'gh') {
      reached = true
      await gate
    }
    return result
  }
  let reached = false
  const first = notePrs(io, true)
  for (let n = 0; n < 50 && !reached; n++) await new Promise(resolve => setTimeout(resolve, 0))
  await notePrs(io, true) // while the first pass is under way
  expect(ghViews(calls)).toEqual(['gh pr view 7'])
  release()
  await first
  expect(ghViews(calls)).toEqual(['gh pr view 7'])
  expect(io.running).toBe(false)
})

test('a PR is stamped as asked before gh answers: a click made meanwhile keeps its fresher info', async () => {
  const { w, io, host, clock } = world({ slots: [] })
  const run = host.run
  let release = () => {}
  const gate = new Promise<void>(resolve => (release = resolve))
  let held = false
  host.run = async (argv, options) => {
    const result = await run(argv, options)
    if (!held && argv.join(' ').startsWith('gh pr view 7 --json') && !argv.join(' ').includes('body')) {
      held = true
      await gate // the pass's answer (head1) arrives late
    }
    return result
  }
  const pass = notePrs(io, true)
  for (let n = 0; n < 50 && !held; n++) await new Promise(resolve => setTimeout(resolve, 0))
  expect(w.known[0]).toMatchObject({ checkedAt: 1_000_000, info: null }) // stamped before the answer
  w.head = 'head2'
  clock.now += 10
  await openPr(io, ID)
  release()
  await pass
  expect(w.known[0]).toMatchObject({ checkedAt: 1_000_010, info: { headRefOid: 'head2' } })
})

test('a kept value that is not a review: not kept, a new review is made and overwrites it', async () => {
  const { w, io, store } = world()
  store.set(KEY, { summary: 'no files' })
  await openPr(io, ID)
  expect(w.requests).toHaveLength(1)
  expect(prSlot(w)).toMatchObject({ status: 'idle', error: null })
  expect((store.get(KEY) as Review).files).toHaveLength(1)
})

test('a PR linked to an awake folder stays in the conversation once the folder moves on', async () => {
  const branches = { '/w/tree': 'feat/x' }
  const { w, io, clock } = world({ branches })
  await notePrs(io, true)
  expect(w.known[0]).toMatchObject({ folder: '/w/tree', fromBranch: true })
  branches['/w/tree'] = 'main'
  clock.now += 301_000
  await notePrs(io, true)
  expect(w.known[0]).toMatchObject({ folder: null, fromBranch: true })
  expect(groupOf(w.known[0]!, new Set())).toBe('conversation')
})

test('a review kept where the PR was opened, reopened where it is only viewed: every origin is inferred, no model call', async () => {
  const { w, io } = world({ messages: [LINK, CREATED] })
  await notePrs(io, false)
  await openPr(io, ID)
  expect(prSlot(w)!.review!.intentions.map(i => i.origin)).toEqual(['conversation'])
  w.slots = w.slots.filter(s => s.root !== ID) // another session, which only views the PR
  w.known = []
  io.messages = async () => [LINK]
  await openPr(io, ID)
  expect(w.requests).toHaveLength(1)
  expect(prSlot(w)!.review!.intentions.map(i => i.origin)).toEqual(['inferred'])
})

test('a review kept where the PR was opened, reopened where it was opened too: the origins are untouched', async () => {
  const { w, io } = world({ messages: [LINK, CREATED] })
  await notePrs(io, false)
  await openPr(io, ID)
  w.slots = w.slots.filter(s => s.root !== ID)
  await openPr(io, ID)
  expect(w.requests).toHaveLength(1)
  expect(prSlot(w)!.review!.intentions.map(i => i.origin)).toEqual(['conversation'])
})

const diffCalls = (calls: { line: string }[]) => calls.filter(c => c.line.startsWith('gh pr diff')).length

test('a PR slot restored without its code gets it back during a watched pass: no model call, nothing while unwatched', async () => {
  const { w, io, calls } = world()
  await openPr(io, ID)
  w.slots = w.slots.map(storable) // what a resume finds: the store keeps no code
  expect(prSlot(w)!.review!.files[0]!.changes[0]!.text).toBe('')
  const diffs = diffCalls(calls)
  await notePrs(io, false)
  expect(prSlot(w)!.review!.files[0]!.changes[0]!.text).toBe('')
  expect(diffCalls(calls)).toBe(diffs)
  await notePrs(io, true)
  expect(prSlot(w)!.review!.files[0]!.changes[0]!.text).toContain('+y')
  expect(w.requests).toHaveLength(1)
  const writes = w.slotWrites
  await notePrs(io, true)
  expect(w.slotWrites).toBe(writes)
})

test('a refill that fails is tried once per slot and head, not at every pass', async () => {
  const { w, io, host } = world()
  await openPr(io, ID)
  w.slots = w.slots.map(storable)
  const run = host.run
  let tries = 0
  host.run = async (argv, options) => {
    if (!argv.join(' ').startsWith('gh pr diff')) return run(argv, options)
    tries++
    return { exitCode: 1, stdout: '', stderr: 'HTTP 502', truncated: false }
  }
  await notePrs(io, true)
  await notePrs(io, true)
  expect(tries).toBe(1)
  expect(prSlot(w)!.review!.files[0]!.changes[0]!.text).toBe('')
  expect(prSlot(w)).toMatchObject({ status: 'idle' })
})
