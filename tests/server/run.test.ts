import { expect, test } from 'claude-code/testing'
import type { KnownPr, Review, Slot } from '../../hooks/model'
import type { Page } from '../../hooks/server/link'
import { awaitReady, endPage, newPageRun, onServer, startPage, writePage, type PageActions, type PageIO } from '../../hooks/server/run'
import { fakeHost } from '../helpers/fake-host'

const HUNK = '@@ -1,2 +1,3 @@'
const DIFF = `diff --git a/a.ts b/a.ts\nindex 1..2 100644\n--- a/a.ts\n+++ b/a.ts\n${HUNK}\n x\n+y\n z\n`
const TOKEN = 'ab'.repeat(16)
const review: Review = {
  source: { kind: 'conversation', repo: '/r', ref: 'base1' }, diffHash: 'h1', summary: 'Résumé', intentions: [],
  files: [{ path: 'a.ts', role: 'Rôle', importance: 'key', status: 'modified', changes: [{ hunk: HUNK, lines: [1, 3], intention: null, explanation: 'Ajoute y', text: '' }] }],
  skipped: [], generatedAt: '2026-10-18T10:00:00.000Z',
}
const awake: Slot = {
  root: '/r', name: 'r', start: 's0', preexisting: [], resetStart: false, diffHash: 'h1',
  review, status: 'idle', error: null, empty: false, gone: false, dormant: null, answers: [],
}

/** Lets the promise chains under way run as far as they can. */
const flush = async () => {
  for (let i = 0; i < 200; i++) await Promise.resolve()
}

type Options = { python?: boolean; pieces?: string[]; ends?: boolean; fails?: boolean; page?: Page; id?: string }

/** A Claude Code seen through the PageIO: a server whose output the test writes, the PAGE value, writes and sleeps recorded. */
function world(options: Options = {}) {
  const { python = true, pieces = ['{"type":"ready","port":4312}\n'], ends = false, fails = false } = options
  const { host, calls } = fakeHost([
    [/^\/usr\/bin\/python3 -c/, { stdout: python ? 'True\n' : '', exitCode: python ? 0 : 1 }],
    [/rev-parse --abbrev-ref HEAD/, { stdout: 'feat/x\n' }],
    [/ diff /, { stdout: DIFF }],
    [/ls-files/, { stdout: '' }],
    [/^(mv|rm) /, {}],
  ])
  const w = {
    page: options.page ?? null, pages: [] as Page[], spawns: [] as (readonly string[])[], writes: [] as string[], texts: [] as string[], stops: 0, known: [] as KnownPr[], slugs: new Map<string, string | null>(),
    id: options.id ?? 'me', say: (_text: string) => {}, wake: () => {}, endSleep: () => {}, calls,
  }
  const io: PageIO = {
    host, lang: 'fr', known: () => w.known, slugs: () => w.slugs, pluginRoot: '/p', random: () => 0,
    sessionId: async () => w.id,
    spawn: argv => {
      w.spawns.push(argv)
      const queue = [...pieces]
      let done = false
      w.say = text => (queue.push(text), w.wake())
      async function* output() {
        if (fails) throw new Error('cannot start')
        for (;;) {
          while (queue.length > 0) yield { stream: 'stdout' as const, text: queue.shift()! }
          if (done || ends) return
          await new Promise<void>(resolve => (w.wake = resolve))
        }
      }
      return { output: output(), stop: () => ((w.stops += 1), (done = true), w.wake()) }
    },
    write: async (path, text) => void (w.writes.push(path), w.texts.push(text)),
    readPage: async () => w.page,
    setPage: async page => void (w.pages.push(page), (w.page = page)),
    sleep: () => new Promise<void>(resolve => (w.endSleep = resolve)),
    read: async () => '',
    cwd: async () => '/w',
    hasArtifact: async () => false,
    artifact: async () => ({ deny: 'none' }),
    setPublished: async () => {},
    setBranches: async () => {},
  }
  const log: string[] = []
  const actions: PageActions = {
    here: (root, path, hunk) => void log.push(`here ${root} ${path} ${hunk}`),
    ask: (root, text) => void log.push(`ask ${root} ${text}`),
    selection: (root, path, from, to, text) => void log.push(`selection ${root} ${path} ${from}-${to} ${text}`),
    refresh: async root => void log.push(`refresh ${root}`),
  }
  return { w, io, log, actions, run: newPageRun() }
}

test('review.json carries the Sources column: the repos of the folders, their branch and the PRs the session knows', async () => {
  const { w, io, actions, run } = world()
  w.slugs.set('/r', 'a/app')
  w.known = [{
    ref: { slug: 'a/app', number: 4 }, opened: true, fromBranch: false, checkedAt: 1, unreachable: false, folder: null,
    info: { slug: 'a/app', number: 4, title: 'T', state: 'open', url: 'https://github.com/a/app/pull/4', headRefName: 'feat/x', headRefOid: 'h', baseRefName: 'main', baseRefOid: 'b' },
  }]
  await startPage(io, run, () => [awake], actions)
  await flush()
  const data = JSON.parse(w.texts[w.texts.length - 1]!)
  expect(data.sources).toEqual([{
    repo: 'a/app', branches: [{ root: '/r', name: 'r', branch: 'feat/x' }],
    prs: [{ number: 4, title: 'T', state: 'open', url: 'https://github.com/a/app/pull/4', group: 'conversation', target: 'pr:a/app#4', reviewed: false, behind: false }],
  }])
})

test('no folder shown yet: nothing starts', async () => {
  const { w, io, actions, run } = world()
  await startPage(io, run, () => [{ ...awake, dormant: 'd' }], actions)
  expect(w.calls).toEqual([])
  expect(run.tried).toBe(false)
})

test('no folder shown but a PR known: the server starts, for « Ouvrir » on that PR', async () => {
  const { w, io, actions, run } = world()
  w.known = [{ ref: { slug: 'a/app', number: 4 }, opened: false, fromBranch: false, info: null, checkedAt: null, unreachable: false, folder: null }]
  await startPage(io, run, () => [{ ...awake, dormant: 'd' }], actions)
  expect(w.spawns).toHaveLength(1)
  await endPage(io, run)
})

test('python missing: the page says so, nothing spawns, and it is not tried again', async () => {
  const { w, io, actions, run } = world({ python: false })
  await startPage(io, run, () => [awake], actions)
  expect(w.pages).toEqual([{ error: 'python' }])
  expect(w.spawns).toEqual([])
  const lookups = w.calls.length
  await startPage(io, run, () => [awake], actions)
  expect(w.calls).toHaveLength(lookups)
})

test('the first start: the folder of the session, any free port and a new token; ready gives the link and review.json follows', async () => {
  const { w, io, actions, run } = world()
  await startPage(io, run, () => [awake], actions)
  await flush()
  expect(w.spawns).toEqual([
    ['/usr/bin/python3', '/p/server/serve.py', '--dir', '/Users/me/.claude-mods/intent/me', '--page', '/p/page', '--token', '0'.repeat(32), '--port', '0'],
  ])
  expect(w.page).toEqual({ url: `http://127.0.0.1:4312/?t=${'0'.repeat(32)}`, port: 4312, token: '0'.repeat(32) })
  expect(w.writes[0]).toMatch(/^\/Users\/me\/\.claude-mods\/intent\/me\/review\.json\.tmp-\d+$/)
  expect(w.calls.map(c => c.line)).toContain(`mv -f ${w.writes[0]} /Users/me/.claude-mods/intent/me/review.json`)
})

test('a page kept from before a reload: same port and token; the link follows the port the server found', async () => {
  const kept = { url: `http://127.0.0.1:4312/?t=${TOKEN}`, port: 4312, token: TOKEN }
  const { w, io, actions, run } = world({ page: kept, pieces: ['{"type":"ready","port":5000}\n'] })
  await startPage(io, run, () => [awake], actions)
  await flush()
  expect(w.spawns[0]!.slice(-4)).toEqual(['--token', TOKEN, '--port', '4312'])
  expect(w.page).toEqual({ url: `http://127.0.0.1:5000/?t=${TOKEN}`, port: 5000, token: TOKEN })
})

test('a server that ends before it is ready, or cannot start: the page says it did not start, and nothing more is written', async () => {
  for (const options of [{ ends: true, pieces: [] }, { fails: true }]) {
    const { w, io, actions, run } = world(options)
    await startPage(io, run, () => [awake], actions)
    await flush()
    expect(w.page).toEqual({ error: 'start' })
    expect(run.server).toBeNull()
    const writes = w.writes.length
    await writePage(io, run, () => [awake])
    expect(w.writes).toHaveLength(writes)
  }
})

test('a server that was ready and then ends: the page says it stopped', async () => {
  const { w, io, actions, run } = world({ ends: true })
  await startPage(io, run, () => [awake], actions)
  await flush()
  expect(w.pages[0]).toMatchObject({ port: 4312 })
  expect(w.page).toEqual({ error: 'stopped' })
  expect(run.server).toBeNull()
  expect(run.ready).toBe(false) // its ready came before its end, which wins
})

test('ready: the flag follows the server, from its start to its end; a wait on a ready server resolves at once', async () => {
  const { w, io, actions, run } = world({ pieces: [] })
  expect(await awaitReady(io, run)).toBe(false) // no server
  await startPage(io, run, () => [awake], actions)
  await flush()
  expect(run.ready).toBe(false)
  w.say('{"type":"ready","port":4312}\n')
  await flush()
  expect(run.ready).toBe(true)
  expect(await awaitReady(io, run)).toBe(true)
  await endPage(io, run)
  expect(run.ready).toBe(false)
})

test('a wait resolves true once the server says ready, after the page holds its address', async () => {
  const { w, io, actions, run } = world({ pieces: [] })
  await startPage(io, run, () => [awake], actions)
  await flush()
  let pageAtReady: Page = null
  const waiting = awaitReady(io, run).then(ready => ((pageAtReady = w.page), ready))
  w.say('{"type":"ready","port":4312}\n')
  expect(await waiting).toBe(true)
  expect(pageAtReady).toMatchObject({ port: 4312 })
  expect(w.stops).toBe(0)
  await endPage(io, run)
})

test('a wait resolves false when the server ends first, or at session end', async () => {
  for (const ending of ['server', 'session'] as const) {
    const { w, io, actions, run } = world({ pieces: [] })
    await startPage(io, run, () => [awake], actions)
    await flush()
    const waiting = awaitReady(io, run)
    if (ending === 'server') run.server!.stop()
    else void endPage(io, run)
    expect(await waiting).toBe(false)
    expect(run.ready).toBe(false)
    if (ending === 'server') expect(w.page).toEqual({ error: 'start' })
  }
})

test('a server not ready within the wait is stopped: the wait resolves false and the page says it did not start', async () => {
  const { w, io, actions, run } = world({ pieces: [] })
  await startPage(io, run, () => [awake], actions)
  await flush()
  const waiting = awaitReady(io, run)
  await flush()
  w.endSleep() // the 10 s are over
  expect(await waiting).toBe(false)
  await flush()
  expect(w.stops).toBe(1)
  expect(run.server).toBeNull()
  expect(w.page).toEqual({ error: 'start' })
})

test('session end while the start still waits (python lookup, session id): nothing spawns, nothing is kept', async () => {
  for (const late of ['sessionId', 'python'] as const) {
    const { w, io, actions, run } = world()
    let answer = () => {}
    const gate = new Promise<void>(resolve => (answer = resolve))
    if (late === 'sessionId') {
      io.sessionId = async () => (await gate, w.id)
    } else {
      const run0 = io.host.run
      io.host.run = async (argv, opts) => (argv.includes('-c') && (await gate), run0(argv, opts))
    }
    const starting = startPage(io, run, () => [awake], actions)
    await flush()
    await endPage(io, run)
    answer()
    await starting
    await flush()
    expect(w.spawns).toEqual([])
    expect(w.pages).toEqual([])
    expect(run.dir).toBeNull()
    expect(run.server).toBeNull()
  }
})

test('two starts racing after an end: only one server', async () => {
  const { w, io, actions, run } = world()
  await startPage(io, run, () => [awake], actions)
  await flush()
  await endPage(io, run)
  let answer = () => {}
  const gate = new Promise<void>(resolve => (answer = resolve))
  const run0 = io.host.run
  io.host.run = async (argv, opts) => (argv.includes('-c') && (await gate), run0(argv, opts))
  const first = startPage(io, run, () => [awake], actions)
  await flush()
  await endPage(io, run)
  w.id = 'next' // a /clear: the second start belongs to another session
  const second = startPage(io, run, () => [awake], actions)
  answer()
  await Promise.all([first, second])
  await flush()
  expect(w.spawns).toHaveLength(2) // the first session's server, then one only, the second start's
  expect(w.spawns[1]![3]).toBe('/Users/me/.claude-mods/intent/next')
  await endPage(io, run)
})

test("asks go to the pane's sends; a refresh or a signal counts the page as open for 25 s", async () => {
  const { io, log, actions, run } = world()
  const slots = () => [awake]
  await onServer(io, run, slots, { type: 'ask', kind: 'here', root: '/r', path: 'a.ts', hunk: HUNK }, TOKEN, actions)
  await onServer(io, run, slots, { type: 'ask', kind: 'free', root: '/r', text: 'pourquoi ?' }, TOKEN, actions)
  await onServer(io, run, slots, { type: 'ask', kind: 'selection', root: '/r', path: 'a.ts', from: 3, to: 5, text: 'x' }, TOKEN, actions)
  await onServer(io, run, slots, { type: 'publish', root: '/r' }, TOKEN, actions) // no Artifact tool here: nothing
  expect(run.viewerUntil).toBe(0)
  await onServer(io, run, slots, { type: 'refresh', root: '/r' }, TOKEN, actions)
  expect(run.viewerUntil).toBe(25_000)
  run.viewerUntil = 0
  await onServer(io, run, slots, { type: 'viewer' }, TOKEN, actions)
  expect(run.viewerUntil).toBe(25_000)
  expect(log).toEqual([`here /r a.ts ${HUNK}`, 'ask /r pourquoi ?', 'selection /r a.ts 3-5 x', 'refresh /r'])
})

test('session end: the server stops, a write under way ends first, then the folder goes and the link with it', async () => {
  const { w, io, actions, run } = world()
  await startPage(io, run, () => [awake], actions)
  await flush()
  const writes = w.writes.length
  void writePage(io, run, () => [awake])
  await endPage(io, run)
  expect(w.stops).toBe(1)
  expect(w.writes).toHaveLength(writes) // the write after the end found no folder to write to
  const lines = w.calls.map(c => c.line)
  expect(lines[lines.length - 1]).toBe('rm -rf /Users/me/.claude-mods/intent/me')
  expect(w.page).toBeNull()
  expect(run.server).toBeNull()
})

test('a write still under way when the wait runs out writes nothing once the folder is gone', async () => {
  const { w, io, actions, run } = world()
  await startPage(io, run, () => [awake], actions)
  await flush()
  const writes = w.writes.length
  // git answers late: the write is still building the reviews.
  let answer = () => {}
  const run0 = io.host.run
  io.host.run = async (argv, opts) => {
    if (argv.includes('diff')) await new Promise<void>(resolve => (answer = resolve))
    return run0(argv, opts)
  }
  run.wide.clear()
  void writePage(io, run, () => [{ ...awake, diffHash: 'h2' }])
  await flush()
  const ending = endPage(io, run)
  await flush()
  w.endSleep()
  await ending
  answer()
  await flush()
  expect(w.writes).toHaveLength(writes)
})

test('after session end (a /clear goes on under another id), the next start takes the current session', async () => {
  const { w, io, actions, run } = world()
  await startPage(io, run, () => [awake], actions)
  await flush()
  await endPage(io, run)
  w.id = 'next'
  await startPage(io, run, () => [awake], actions)
  expect(w.spawns).toHaveLength(2)
  expect(w.spawns[1]![3]).toBe('/Users/me/.claude-mods/intent/next')
})

test('session end when the page was never tried: nothing to remove', async () => {
  const { w, io, run } = world()
  await endPage(io, run)
  expect(w.calls).toEqual([])
  expect(w.pages).toEqual([])
})

/** A world whose Artifact tool refuses every call; `test -d <cwd>/.git` answers `isRepo`. */
function refusing(isRepo: boolean) {
  const world0 = world()
  const { io } = world0
  const calls: string[] = []
  const tests: string[] = []
  io.hasArtifact = async () => true
  io.artifact = async input => (calls.push(input.file_path), { ref: 'r', result: 'outside', text: 'outside', isError: true })
  const run0 = io.host.run
  io.host.run = async (argv, opts) => (argv[0] === 'test' ? (tests.push(argv.join(' ')), { exitCode: isRepo ? 0 : 1, stdout: '', stderr: '' }) : run0(argv, opts))
  return { ...world0, calls, tests }
}

test('publish refused where the session keeps its files, in a worktree (.git is a file): no second try, the page says why', async () => {
  const { io, actions, run, calls, tests } = refusing(false)
  await startPage(io, run, () => [awake], actions)
  await flush()
  await onServer(io, run, () => [awake], { type: 'publish', root: '/r' }, TOKEN, actions)
  await flush()
  expect(calls).toEqual(['/Users/me/.claude-mods/intent/me/publish-r-feat-x.html'])
  expect(tests).toEqual(['test -d /w/.git'])
  expect(run.publishFailed.get('/r')).toBe('refused')
  await endPage(io, run)
})

test('the copy left under .git/info goes at session end, and only it', async () => {
  const { w, io, actions, run, calls } = refusing(true)
  await startPage(io, run, () => [awake], actions)
  await flush()
  await onServer(io, run, () => [awake], { type: 'publish', root: '/r' }, TOKEN, actions)
  await flush()
  expect(calls).toEqual(['/Users/me/.claude-mods/intent/me/publish-r-feat-x.html', '/w/.git/info/intent-publish-r-feat-x.html'])
  await endPage(io, run)
  const lines = w.calls.map(c => c.line)
  expect(lines.filter(line => line.startsWith('rm '))).toEqual(['rm -f /w/.git/info/intent-publish-r-feat-x.html', 'rm -rf /Users/me/.claude-mods/intent/me'])
})
