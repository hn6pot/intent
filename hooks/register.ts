// Wires Claude Code's events to the mod's modules. No logic here.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteRequest, Register, Timer } from 'claude-code'
import { interruptRunning } from './agents/answers'
import type { Ask } from './agents/ask'
import { mapAnswers } from './agents/queue'
import { askQuestion, type QuestionIO } from './agents/run'
import { prLinks } from './github/links'
import { prFile } from './github/pr-file'
import type { Host } from './host'
import { langOf, texts, type Lang, type Texts } from './i18n'
import type { KnownPr, Slot } from './model'
import { isPrRoot, prId, samePr, targetOf } from './prs/known'
import { notePrs, openPr, type PrIO } from './prs/run'
import { joinPath } from './questions'
import { diffBase, type PrBases, workTree } from './repos/base'
import { GIT_MOVES_BASE, touchedFolders } from './repos/detect'
import { computeDiff } from './repos/diff'
import { type Complete, generateReview } from './review/generate'
import { autoSelect } from './review/select'
import { apply, decide, isDormant, isFolder, needsReview, oldestSession, pruneSessions, type Saved, type SlotEvent } from './review/slots'
import { isArtifactUrl } from './export/publish'
import { refill, restored, storable } from './review/stored'
import { track } from './review/track'
import { cleanOld } from './server/launch'
import { isPageError } from './server/link'
import { awaitReady, endPage, newPageRun, type PageActions, type PageIO, type PageRun, startPage, writePage } from './server/run'
import { isWatched } from './server/viewer'
import { drawPane, type PaneButtons } from './ui/pane'

/** The end-of-turn pass runs this long after the main loop's last turn end. */
const TURN_END_MS = 2_000
/** The tools whose calls say which folders the session works in. */
const TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'])

// Declared here, the only file that reads and writes them (the validator asks for it).
const SLOTS = atom({ plugin: 'intent', key: 'slots' } as const, [])
// The PRs of the conversation, kept with the session.
const PRS = atom({ plugin: 'intent', key: 'prs' } as const, [])
const SELECTED = atom({ plugin: 'intent', key: 'selected' } as const, null)
const EXPANDED = atom({ plugin: 'intent', key: 'expanded' } as const, {})
// Closed by hand: never reopened on its own, even after a module reload.
const PANE_CLOSED = atom({ plugin: 'intent', key: 'paneClosed' } as const, false)

// The last question sent: the same question is not sent again until another one goes.
const LAST_SENT = atom({ plugin: 'intent', key: 'lastSent' } as const, null)
// The review page's address: it outlives a module reload, so the next server takes the same port and token.
const PAGE = atom({ plugin: 'intent', key: 'page' } as const, null)
// « Ouvrir la revue » waits for the server: the pane shows it in place of the button.
const OPENING = atom({ plugin: 'intent', key: 'opening' } as const, false)
// The artifact address per folder, for the pane: written with each review.json.
const PUBLISHED = atom({ plugin: 'intent', key: 'published' } as const, {})
// The branch per folder, for the pane's folder picker: written with each review.json.
const BRANCHES = atom({ plugin: 'intent', key: 'branches' } as const, {})

type State = {
  t: Texts
  lang: Lang
  host: Host | null
  /** `session:<id>` in the store. */
  key: string
  slots: Slot[]
  selected: string | null
  /** Opened by the mod in this module's life (closed by hand lives in PANE_CLOSED). */
  opened: boolean
  /** Old sessions are pruned with the first write: nothing is written without an interface. */
  pruned: boolean
  timer: Timer | null
  /** Folders whose pass is under way: one at a time per folder. */
  busy: Set<string>
  /** Folders asked for again during their pass: one more pass when it ends. */
  redo: Set<string>
  /** Folder of a file → its working folder, once known. */
  roots: Map<string, string>
  /** The PR base per folder and branch, once `gh` named it. */
  prBases: PrBases
  /** The conversation's PRs, and what `notePrs` and `openPr` keep between two calls. */
  prs: Pick<PrIO, 'asked' | 'busy' | 'slugs' | 'running'> & { known: KnownPr[] }
  /** The session's own folder, registered as only read at the first event that has an interface. */
  startFolder: string | null
  /** The session's own folder, preferred when the pane picks a folder; and whether the person picked one. */
  cwd: string | null
  chosen: boolean
  /** The review page's server and files. */
  page: PageRun
  /** « Ouvrir la revue » waits for the server in this module (OPENING outlives a reload, this does not). */
  opening: boolean
  /** Aborted at session end: cuts the questions' model calls still running. */
  stop: AbortController
}

// Here and not in host.ts: Claude Code refuses `$` crossing an import.
async function hostFrom($: EngineInterface): Promise<Host> {
  return {
    run: async (argv, options) => {
      const r = await $.process.run(argv, options)
      return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, truncated: r.isStdoutTruncated }
    },
    now: () => $.clock.now(),
    store: {
      get: key => $.store.get(key),
      set: (key, value) => $.store.set(key, value),
      delete: key => $.store.delete(key),
      keys: () => $.store.keys(),
    },
    home: (await $.env.get('HOME')) ?? '',
  }
}

/** One completion: its text, or why there is none (an API error with its status, an empty reply, a cut call). */
function completeWith($: EngineInterface, signal?: AbortSignal): (request: ModelCompleteRequest) => ReturnType<Complete> {
  return async request => {
    const reply = await $.model.complete(request, signal ? { signal } : undefined)
    if (reply.isAnswered) return { text: reply.text }
    return { error: reply.reason === 'api-error' ? `api-error ${reply.status ?? 'no response'} (${reply.error})` : reply.reason }
  }
}

async function hasInterface($: EngineInterface): Promise<boolean> {
  return (await $.session.surfaces()).length > 0
}

async function sessions($: EngineInterface): Promise<[string, Saved][]> {
  const keys = (await $.store.keys()).filter(key => key.startsWith('session:'))
  return Promise.all(keys.map(async key => [key, (await $.store.get(key)) as Saved] as [string, Saved]))
}

async function prune($: EngineInterface, state: State) {
  state.pruned = true
  for (const key of pruneSessions(await sessions($), await $.clock.now())) await $.store.delete(key)
  if (state.host) await cleanOld(state.host, state.host.home, await $.clock.now()) // the page's session folders too
}

/** The session's slots without hunk code, and its PRs; a refused write (4 MiB in all) drops the oldest session and tries once more. */
async function save($: EngineInterface, state: State) {
  const saved: Saved = { updatedAt: await $.clock.now(), slots: state.slots.map(storable), prs: state.prs.known }
  try {
    await $.store.set(state.key, saved)
  } catch {
    const oldest = oldestSession(await sessions($), state.key)
    if (oldest === null) return
    await $.store.delete(oldest)
    await $.store.set(state.key, saved)
  }
}

/** After each slot change: the pane redraws and the store keeps the session's slots for a resume. */
async function publish($: EngineInterface, state: State) {
  await update($, SLOTS, () => state.slots)
  await pickFolder($, state)
  if (state.host) void writePage(pageIO($, state, state.host), state.page, () => state.slots)
  if (!state.pruned) await prune($, state)
  // A write still refused costs the resume only, never the review.
  await save($, state).catch(() => undefined)
}

/** What the page server needs of Claude Code. Here and not in run.ts: Claude Code refuses `$` crossing an import. */
function pageIO($: EngineInterface, state: State, host: Host): PageIO {
  return {
    host, lang: state.lang, known: () => state.prs.known, slugs: () => state.prs.slugs, pluginRoot: $.plugin.root,
    // The token guards the local server: crypto-backed, never Math.random.
    random: () => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32,
    sessionId: () => $.session.id(),
    spawn: argv => {
      const stream = $.process.spawn({ argv })
      return { output: stream, stop: () => void stream.return({ code: null, signal: null }).catch(() => undefined) }
    },
    write: (path, text) => $.fs.write(path, text),
    readPage: () => read($, PAGE),
    setPage: page => update($, PAGE, () => page).then(() => undefined),
    sleep: ms => $.clock.sleep(ms),
    read: async path => String(await $.fs.read(path)),
    cwd: () => $.session.cwd(),
    hasArtifact: async () => (await $.tool.list()).some(tool => tool.name === 'Artifact'),
    artifact: (input, consent) => $.tool.call({ tool: 'Artifact', consent, ...input }),
    setPublished: published => update($, PUBLISHED, () => published).then(() => undefined),
    setBranches: branches => update($, BRANCHES, () => branches).then(() => undefined),
  }
}

/** What the PRs need of Claude Code. Here and not in prs/run.ts: Claude Code refuses `$` crossing an import. */
function prIO($: EngineInterface, state: State, host: Host): PrIO {
  const { prs } = state
  return {
    host, t: state.t, slots: () => state.slots,
    setSlots: slots => ((state.slots = slots), publish($, state)),
    known: () => prs.known,
    setKnown: known => ((prs.known = known), update($, PRS, () => known).then(() => publish($, state))),
    messages: () => $.session.messages(),
    complete: completeWith($),
    asked: prs.asked, busy: prs.busy, slugs: prs.slugs,
    get running() { return prs.running },
    set running(value) { prs.running = value },
  }
}

async function change($: EngineInterface, state: State, root: string, event: SlotEvent) {
  state.slots = state.slots.map(s => (s.root === root ? apply(s, event) : s))
  await publish($, state)
}

/** On the side at the first slot; never reopened on its own once closed by hand. */
async function openPane($: EngineInterface, state: State) {
  if (state.opened || !state.slots.some(s => isFolder(s) && !isDormant(s)) || (await read($, PANE_CLOSED))) return
  state.opened = true
  // Literal: the validator refuses an imported constant; same value as the pane's requestId below.
  await $.ui.open({ id: 'intent', title: state.t.paneTitle }).catch(() => undefined)
}

/** One folder: its diff since the starting point, then what the end of the turn does with it. */
async function refreshNow($: EngineInterface, state: State, host: Host, root: string) {
  const at = () => state.slots.find(s => s.root === root)
  let slot = at()
  if (!slot || slot.gone) return
  let { base, mode } = await diffBase(host, root, slot, state.prBases)
  if (slot.resetStart && mode === 'branch') {
    await change($, state, root, { kind: 'keep-start' })
    slot = at()!
  } else if (slot.resetStart) {
    const head = await host.run(['git', '-C', root, 'rev-parse', 'HEAD'])
    if (head.exitCode === 0 && head.stdout.trim() !== '') {
      base = head.stdout.trim()
      await change($, state, root, { kind: 'reset-start', start: base })
      slot = at()!
    }
  }
  const diff = await computeDiff(host, root, base, slot.preexisting)
  if (isDormant(slot)) {
    // Only read so far: it stays hidden while its diff is the one of its first touch.
    if ('error' in diff || diff.hash === slot.dormant) return
    await change($, state, root, { kind: 'wake' })
    slot = at()!
    await show($, state)
  }
  if ('error' in diff) {
    // Gone only when git no longer finds the folder; any other failure says why.
    const gone = (await workTree(host, root)) === null
    await change($, state, root, gone ? { kind: 'gone' } : { kind: 'failed', error: diff.error })
    return
  }
  // A resumed review was saved without its code: the diff gives it back.
  const review = slot.review && refill(slot.review, diff.files)
  if (review && review !== slot.review) {
    await change($, state, root, { kind: 'refill', review })
    slot = at()!
  }
  // Watched: the pane open, or the page open.
  const action = decide(slot, diff, isWatched(await read($, PANE_CLOSED), await host.now(), state.page.viewerUntil))
  if (action === 'empty' || action === 'stale') await change($, state, root, { kind: action })
  // Back to the reviewed diff (a stale review, or one cut by a restart): up to date again.
  else if (action === 'nothing' && slot.status === 'stale' && slot.review) await change($, state, root, { kind: 'done', review: slot.review })
  else if (action === 'generate') {
    await change($, state, root, { kind: 'running' })
    try {
      const result = await generateReview(completeWith($), {
        t: state.t, repo: root, ref: base, diff, transcript: await $.session.messages(), previous: slot.review, now: await host.now(),
      })
      await change($, state, root, 'error' in result ? { kind: 'failed', error: result.error } : { kind: 'done', review: result })
    } catch {
      await change($, state, root, { kind: 'failed', error: 'model' })
    }
  }
}

/** One pass at a time per folder; a command that cannot start or times out shows as a failure, never as nothing. A PR root opens the PR's review. */
async function refresh($: EngineInterface, state: State, root: string) {
  const { host } = state
  if (!host) return
  if (isPrRoot(root)) return openPr(prIO($, state, host), root)
  // Asked for during its pass (a turn end, a retry, /intent): it runs again once that pass ends.
  if (state.busy.has(root)) {
    state.redo.add(root)
    return
  }
  state.busy.add(root)
  try {
    await refreshNow($, state, host, root)
  } catch {
    await change($, state, root, { kind: 'failed', error: 'git' }).catch(() => undefined)
  } finally {
    state.busy.delete(root)
    if (state.redo.delete(root)) void pass($, state, root).catch(() => undefined)
  }
}

/** The end-of-turn pass, for every folder or one root, then the PRs; nothing at all without an interface. */
async function pass($: EngineInterface, state: State, only?: string, wake = false) {
  const { host } = state
  if (!host || !(await hasInterface($))) return
  await trackStart(state, host)
  // Asked for by hand (/intent): the folders only read are reviewed too.
  if (wake) {
    for (const slot of state.slots.filter(s => isFolder(s) && isDormant(s))) {
      await change($, state, slot.root, { kind: 'wake' })
      await show($, state)
    }
  }
  await openPane($, state)
  // A reload during an opening left it shown: no opening is under way in this module.
  if (!state.opening && (await read($, OPENING))) await update($, OPENING, () => false)
  await startPageNow($, state, host)
  const roots = state.slots.filter(s => (only === undefined ? isFolder(s) : s.root === only)).map(s => s.root)
  await Promise.all(roots.map(root => refresh($, state, root)))
  await startPageNow($, state, host) // a folder this pass woke
  await notePrs(prIO($, state, host), isWatched(await read($, PANE_CLOSED), await host.now(), state.page.viewerUntil))
}

/** A press on a folder only read wakes it first; a PR root opens the PR. */
async function wakeAndRefresh($: EngineInterface, state: State, root: string) {
  if (state.slots.some(s => s.root === root && isFolder(s) && isDormant(s))) {
    await change($, state, root, { kind: 'wake' })
    await show($, state)
  }
  await refresh($, state, root)
}

/**
 * The page's server, if it may start: from a pass or « Ouvrir la revue », never from a tool call (an interrupted call
 * would abort the spawn and kill the server). The questions come from the page only.
 */
function startPageNow($: EngineInterface, state: State, host: Host) {
  const ask = (question: Ask) => void askQuestion(questionIO($, state), question).catch(() => undefined)
  const actions: PageActions = {
    here: (root, path, hunk) => ask({ kind: 'here', root, path, hunk }),
    ask: (root, text) => ask({ kind: 'free', root, text }),
    selection: (root, path, from, to, text) => ask({ kind: 'selection', root, path, from, to, text }),
    refresh: root => wakeAndRefresh($, state, root),
  }
  return startPage(pageIO($, state, host), state.page, () => state.slots, actions).catch(() => undefined)
}

/** « Ouvrir la revue »: a page down in this module (a reload, a stop) starts again first, and opens once its server is ready (10 s at most), on `source` when given. */
async function openPage($: EngineInterface, state: State, source?: string) {
  const { host } = state
  if (state.opening) return // a double press
  if (!state.page.ready) {
    if (!host) return
    state.opening = true
    try {
      await update($, OPENING, () => true)
      if (state.page.server === null) {
        state.page.tried = false
        await startPageNow($, state, host)
      }
      // Not ready in time, or it cannot run: PAGE says why, and the pane shows it.
      if (!(await awaitReady(pageIO($, state, host), state.page))) return
    } finally {
      state.opening = false
      await update($, OPENING, () => false)
    }
  }
  const page = await read($, PAGE)
  if (page && 'url' in page) await $.process.run(['open', source === undefined ? page.url : `${page.url}#source=${encodeURIComponent(source)}`])
}

/** The folder the pane shows, unless the person chose one: one with a review, the session's own first. */
async function pickFolder($: EngineInterface, state: State) {
  const root = autoSelect(state.slots, state.selected, state.chosen, state.cwd)
  if (root === state.selected) return
  state.selected = root
  await update($, SELECTED, () => root)
}

/** A folder now shown: the pane picks what to show, and opens. */
async function show($: EngineInterface, state: State) {
  await pickFolder($, state)
  await openPane($, state)
}

/** The session's own folder counts as only read, once there is an interface (no git without one). */
async function trackStart(state: State, host: Host) {
  const folder = state.startFolder
  if (folder === null) return
  state.startFolder = null
  await track(host, state, folder, true)
}

/** Notes the folders a tool call touches, before the tool runs (their start and untracked files are those before it). */
async function onTool($: EngineInterface, state: State, tool: string, input: Record<string, unknown>, run: () => Promise<void>) {
  const { host } = state
  if (!host) return run()
  await trackStart(state, host)
  const cwd = await $.session.cwd()
  const movesBase = tool === 'Bash' && typeof input.command === 'string' && GIT_MOVES_BASE.test(input.command)
  const touched = touchedFolders(tool, input, cwd, host.home)
  // A plain `git pull` names no folder: it moves the session's own.
  const folders = touched.length === 0 && movesBase ? [cwd] : touched

  const found: string[] = []
  let changed = false
  for (const folder of folders) {
    // A Bash command only says where it looks: its folder stays dormant until its diff changes.
    const tracked = await track(host, state, folder, tool === 'Bash')
    if (!tracked) continue
    found.push(tracked.root)
    changed ||= tracked.changed
  }

  await run()
  if (found.length === 0) return
  if (movesBase) state.slots = state.slots.map(s => (found.includes(s.root) ? { ...s, resetStart: true } : s))
  if (changed || movesBase) await publish($, state)
  if (found.some(root => state.slots.some(s => s.root === root && !isDormant(s)))) await show($, state)
}

/** What the questions need of Claude Code. Here and not in agents/run.ts: Claude Code refuses `$` crossing an import. */
function questionIO($: EngineInterface, state: State): QuestionIO {
  return {
    t: state.t, now: () => $.clock.now(), slots: () => state.slots,
    setSlots: slots => ((state.slots = slots), publish($, state)),
    claim: async key => {
      let fresh = false
      await update($, LAST_SENT, last => ((fresh = last !== key), key))
      return fresh
    },
    release: keys => update($, LAST_SENT, last => (last !== null && keys.includes(last) ? null : last)).then(() => undefined),
    toast: text => $.ui.toast(text),
    readFile: async (root, path) => {
      const pr = state.slots.find(s => s.root === root)?.pr
      return pr === undefined || !state.host ? String(await $.fs.read(joinPath(root, path))) : prFile(state.host, pr, path)
    },
    // The signal as the question was asked: a session end cuts the calls of every question asked before it.
    complete: completeWith($, state.stop.signal),
  }
}

function buttons($: EngineInterface, state: State): PaneButtons {
  const quiet = (work: Promise<unknown>) => void work.catch(() => undefined)
  return {
    toggle: key => quiet(update($, EXPANDED, d => ({ ...d, [key]: !(d[key] ?? false) }))),
    // A press proves the pane is shown: it counts as open again.
    retry: root => quiet(update($, PANE_CLOSED, () => false).then(() => pass($, state, root))),
    select: root => {
      state.selected = root
      state.chosen = true
      quiet(update($, SELECTED, () => root))
    },
    open: () => quiet(openPage($, state)),
    openSource: target => {
      quiet(openPage($, state, target))
      if (needsReview(state.slots, target)) quiet(wakeAndRefresh($, state, target))
    },
    openArtifact: url => (isArtifactUrl(url) ? quiet($.process.run(['open', url])) : undefined),
  }
}

export const register: Register = (on, options) => {
  const lang = langOf(options.language)
  const state: State = {
    t: texts(lang), lang, host: null, key: '', slots: [], selected: null, opened: false, pruned: false,
    timer: null, busy: new Set(), redo: new Set(), roots: new Map(), prBases: new Map(),
    prs: { known: [], asked: new Map(), busy: new Set(), slugs: new Map(), running: false }, startFolder: null, cwd: null, chosen: false,
    page: newPageRun(), opening: false, stop: new AbortController(),
  }
  const { t } = state

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'intent', description: t.commandDescription, argumentHint: t.commandHint })
    state.host = await hostFrom($)
    state.key = `session:${await $.session.id()}`
    state.startFolder = e.cwd
    state.cwd = e.cwd
    // A resumed conversation finds its reviews again; one cut while running is behind.
    const saved = (await $.store.get(state.key)) as Saved | undefined
    if (saved && Array.isArray(saved.slots)) {
      // Its model calls are gone with it: an answer waiting or under way is interrupted.
      state.slots = mapAnswers(saved.slots.map(restored).map(s => (s.status === 'running' ? apply(s, { kind: 'stale' }) : s)), interruptRunning)
      state.prs.known = Array.isArray(saved.prs) ? saved.prs : []
      await update($, SLOTS, () => state.slots)
      await update($, PRS, () => state.prs.known)
    }
    if (await hasInterface($)) await prune($, state)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Also at a resume or a /clear: the questions' calls are cut, the server stops, then the session's files go.
  on('session.end', async ($, e, next) => {
    state.stop.abort()
    state.stop = new AbortController()
    if (state.host) await endPage(pageIO($, state, state.host), state.page)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    // A subagent's calls count too (an agent may do the edits); only the main loop's turn ends generate.
    if (!TOOLS.has(String(e.tool)) || !(await hasInterface($))) return next(e)
    let result: Awaited<ReturnType<typeof next>> | undefined
    await onTool($, state, String(e.tool), e as unknown as Record<string, unknown>, async () => {
      result = await next(e)
    })
    return result ?? next(e)
  }).catch(($, e, next) => next(e)) // a failure of the mod must never block the tool

  // Only the main loop's turn end reviews.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      state.timer?.cancel()
      state.timer = $.clock.after(TURN_END_MS, () => void pass($, state).catch(() => undefined))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.close', async ($, e, next) => {
    if (e.id === 'intent' && e.origin.kind === 'person') await update($, PANE_CLOSED, () => true)
    return next(e)
  })

  on('command.run', { command: 'intent' }, async ($, e) => {
    state.opened = true
    if (isPageError(await read($, PAGE))) state.page.tried = false // a page that could not run is tried again
    await update($, PANE_CLOSED, () => false)
    await $.ui.open({ id: 'intent', title: t.paneTitle, focus: true })
    void pass($, state, undefined, true).catch(() => undefined) // reviews left behind while closed catch up, folders only read wake
    // `/intent <PR link>` (typed, or run by another mod such as lighthouse): the page opens on that PR's review.
    const ref = prLinks(e.args)[0]
    if (ref !== undefined) {
      const known = state.prs.known.find(pr => samePr(pr.ref, ref))
      buttons($, state).openSource(known ? targetOf(known) : prId(ref))
    }
    return {}
  })

  // The mobile table has no Input or Select: the engine's own drawing stands there.
  on('ui.render', { component: 'Pane', requestId: 'intent' }, async ($, e, next) =>
    e.surface === 'mobile'
      ? next(e)
      : drawPane(
        $.ui.resolve(e), await read($, SLOTS), await read($, SELECTED), await read($, EXPANDED),
        { page: await read($, PAGE), opening: await read($, OPENING), published: await read($, PUBLISHED), branches: await read($, BRANCHES), prs: await read($, PRS) },
        buttons($, state), t,
      ),
  )
}
