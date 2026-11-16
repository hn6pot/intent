// The review page's server for one session: started once, fed with review.json, its events turned into actions, stopped at the end.
// No `$` here: register.ts builds the PageIO from it, as it builds the Host.
import { artifactOutcome, publishName, standaloneHtml, type PublishFailure } from '../export/publish'
import type { Host } from '../host'
import { texts, type Lang } from '../i18n'
import type { KnownPr, PageReview, Slot } from '../model'
import { pageData } from '../page/data'
import { pageReviews, type WideDiffs } from '../page/reviews'
import { serial, type Serial } from '../page/serial'
import { pageSources } from '../page/sources'
import { isDormant } from '../review/slots'
import { readEvents, type ServerOutput } from './events'
import { findPython, serverArgv, sessionDir, writeJson } from './launch'
import { launchKey, pageUrl, type Page } from './link'
import type { ServerEvent } from './protocol'
import { viewerUntil } from './viewer'

/** How long session.end waits for a write under way before removing the folder. */
const END_WAIT_MS = 2_000
/** How long « Ouvrir la revue » waits for a server to say ready before it stops it. */
const READY_WAIT_MS = 10_000
/** The page's own files: its shell, and the modules the page imports by name (`./render.js`). */
const SHELL = ['index.html', 'style.css', 'app.js'] as const
const MODULES = ['render.js', 'answers.js', 'escape.js', 'texts.js', 'select.js'] as const

export type ArtifactInput = { file_path: string; url?: string; icon: string; description: string }

/** What the page needs of Claude Code. */
export type PageIO = {
  host: Host
  lang: Lang
  /** The session's PRs: a PR slot's title and head, a folder's linked PR. */
  known: () => readonly KnownPr[]
  /** The GitHub slug of each followed folder, once read (null: no GitHub origin): the Sources column groups by it. */
  slugs: () => ReadonlyMap<string, string | null>
  pluginRoot: string
  sessionId: () => Promise<string>
  /** Starts the server; `stop` leaves its output, which stops it. */
  spawn: (argv: readonly string[]) => { output: ServerOutput; stop: () => void }
  write: (path: string, text: string) => Promise<void>
  readPage: () => Promise<Page>
  setPage: (page: Page) => Promise<void>
  sleep: (ms: number) => Promise<void>
  random: () => number
  read: (path: string) => Promise<string>
  cwd: () => Promise<string>
  /** The Artifact tool is among the model's tools in this session. */
  hasArtifact: () => Promise<boolean>
  /** Calls the Artifact tool, `consent` the person's words for the press; resolves to its whole answer. */
  artifact: (input: ArtifactInput, consent: string) => Promise<unknown>
  /** What the pane shows: root folder to the address of its artifact. */
  setPublished: (published: Record<string, string>) => Promise<void>
  /** What the pane's folder picker shows: root folder to its branch. */
  setBranches: (branches: Record<string, string>) => Promise<void>
}

/** What the page's events do: its questions (one press, one send), selected lines' question, and a folder's refresh. */
export type PageActions = {
  here: (root: string, path: string, hunk: string) => void
  ask: (root: string, text: string) => void
  selection: (root: string, path: string, from: number, to: number, text: string) => void
  refresh: (root: string) => Promise<void>
}

export type PageRun = {
  /** The session's files; null before the first start and after session.end (a /clear goes on under another id). */
  dir: string | null
  /** Tried in this session: once, again by /intent after a failure. */
  tried: boolean
  /** Counts the starts and the ends: a start that waited finds out whether another start or an end came meanwhile. */
  generation: number
  /** The running server; null when none runs. */
  server: { stop: () => void } | null
  /** The running server said ready (its address is in PAGE); false while it starts and once it ends. */
  ready: boolean
  /** Who waits for the server to say ready: true once it did, false if it ended first. */
  waiters: ((ready: boolean) => void)[]
  /** Until when the page counts as open (its last signal or press + 25 s). */
  viewerUntil: number
  /** The diff at 10 lines of context per folder, kept while its review stays. */
  wide: WideDiffs
  writes: Serial
  /** Folders whose publish is under way: one at a time per folder. */
  publishing: Set<string>
  /** Folders whose last publish failed, and why. */
  publishFailed: Map<string, PublishFailure>
  /** Copies written under a repo's `.git/info` by this session: removed at its end. */
  copies: Set<string>
}

export const newPageRun = (): PageRun => ({
  dir: null, tried: false, generation: 0, server: null, ready: false, waiters: [], viewerUntil: 0, wide: new Map(), writes: serial(),
  publishing: new Set(), publishFailed: new Map(), copies: new Set(),
})

/** Where a folder's artifact address is kept: per folder and branch, so republishing a branch updates its artifact. */
const publishedKey = (root: string, branch: string) => `published:${root}|${branch}`

/** The server said ready, or ended: the flag follows, and those who waited learn which. */
function settle(run: PageRun, ready: boolean) {
  run.ready = ready
  for (const waiter of run.waiters.splice(0)) waiter(ready)
}

/** Resolves true once the running server said ready; false when none runs, it ends first, or it takes 10 s (then stopped: its end says the page did not start). */
export async function awaitReady(io: PageIO, run: PageRun): Promise<boolean> {
  const { server } = run
  if (run.ready || server === null) return run.ready
  const ready = await Promise.race([new Promise<boolean>(resolve => run.waiters.push(resolve)), io.sleep(READY_WAIT_MS).then(() => false)])
  if (!ready && run.server === server) server.stop()
  return ready
}

/** The server, at the first pass with a folder shown or a PR known (« Ouvrir » on a PR with no folder awake). `slots` is read again at each write. */
export async function startPage(io: PageIO, run: PageRun, slots: () => readonly Slot[], actions: PageActions): Promise<void> {
  if (run.tried || !(io.known().length > 0 || slots().some(s => !isDormant(s)))) return
  run.tried = true
  const generation = ++run.generation
  const dir = run.dir ?? sessionDir(io.host.home, await io.sessionId())
  const python = await findPython(io.host)
  const page = await io.readPage()
  // session.end, or another start, came during the waits: this start is over.
  if (run.generation !== generation) return
  run.dir = dir
  if (python === null) return io.setPage({ error: 'python' })
  const { port, token } = launchKey(page, io.random)
  const { output, stop } = io.spawn(serverArgv(python, io.pluginRoot, dir, token, port))
  const server = { stop }
  run.server = server
  run.ready = false
  let ready = false
  void writePage(io, run, slots)
  void readEvents(output, event => {
    if (event.type === 'ready') ready = true
    void onServer(io, run, slots, event, token, actions)
      // Once PAGE holds the address, and only while this server runs (it may end meanwhile): a waiter opens it.
      .then(() => event.type === 'ready' && run.server === server && settle(run, true))
      .catch(() => undefined)
  })
    .catch(() => undefined)
    .then(async () => {
      // An end session.end did not ask for: the page cannot run, whether its server stopped or never started.
      if (run.server !== server) return
      run.server = null
      settle(run, false)
      await io.setPage({ error: ready ? 'stopped' : 'start' })
    })
    .catch(() => undefined)
}

/** What the page reads, rewritten while the server runs; one write at a time. Never rejects. */
export function writePage(io: PageIO, run: PageRun, slots: () => readonly Slot[]): Promise<void> {
  if (run.server === null) return Promise.resolve()
  return run.writes(async () => {
    const dir = run.dir
    if (dir === null || run.server === null) return
    const reviews = await pageReviews(io.host, slots(), run.wide, io.known())
    // session.end came meanwhile: its folder is gone, nothing recreates it.
    if (run.dir !== dir) return
    const publish = await io.hasArtifact().catch(() => false)
    const published: Record<string, string> = {}
    const failed: Record<string, string> = {}
    const t = texts(io.lang)
    for (const review of reviews) {
      const url = await publishedUrl(io, review)
      if (url !== null) published[review.root] = url
      const failure = run.publishFailed.get(review.root)
      if (failure) failed[review.root] = t.page.publishFailed(t.page.publishReason[failure])
    }
    await io.setPublished(published)
    const branches = Object.fromEntries(reviews.map(review => [review.root, review.branch]))
    await io.setBranches(branches)
    const sources = pageSources(slots(), io.known(), io.slugs(), branches)
    await writeJson(io.host, io.write, `${dir}/review.json`, pageData(io.lang, reviews, await io.host.now(), publish, published, failed, sources))
  })
}

async function publishedUrl(io: PageIO, review: PageReview): Promise<string | null> {
  const url = await io.host.store.get(publishedKey(review.root, review.branch))
  return typeof url === 'string' ? url : null
}

export async function onServer(
  io: PageIO, run: PageRun, slots: () => readonly Slot[], event: ServerEvent, token: string, actions: PageActions,
): Promise<void> {
  if (event.type === 'ready') await io.setPage({ url: pageUrl(event.port, token), port: event.port, token })
  else if (event.type === 'ask' && event.kind === 'here') actions.here(event.root, event.path ?? '', event.hunk ?? '')
  else if (event.type === 'ask' && event.kind === 'selection') actions.selection(event.root, event.path, event.from, event.to, event.text)
  else if (event.type === 'ask') actions.ask(event.root, event.text ?? '')
  else if (event.type === 'viewer' || event.type === 'refresh') {
    // A press on the page proves it is open, as its signal does.
    run.viewerUntil = viewerUntil(await io.host.now())
    if (event.type === 'refresh') await actions.refresh(event.root)
  } else if (event.type === 'publish') await publishPage(io, run, slots, event.root)
}

/**
 * « Publier »: the folder's standalone page, published as a claude.ai artifact (the Artifact tool, with its usual permission
 * dialog). Republishing a branch updates its artifact; refused, published anew (the tool updates only an artifact this
 * conversation published). Written in the session's folder; refused there too, written again under the session's
 * `.git/info` when `.git` is a folder (not a worktree). Without the Artifact tool, nothing. The page learns the address, or why not.
 */
export async function publishPage(io: PageIO, run: PageRun, slots: () => readonly Slot[], root: string): Promise<void> {
  const dir = run.dir
  if (dir === null || run.publishing.has(root)) return
  run.publishing.add(root)
  try {
    if (!(await io.hasArtifact())) return
    const reviews = await pageReviews(io.host, slots(), run.wide, io.known())
    const review = reviews.find(r => r.root === root)
    if (!review) return
    const read = (name: string) => io.read(`${io.pluginRoot}/page/${name}`)
    const [index = '', css = '', app = ''] = await Promise.all(SHELL.map(read))
    const imported = Object.fromEntries(await Promise.all(MODULES.map(async name => [`./${name}`, await read(name)] as const)))
    const html = standaloneHtml(index, css, app, imported, pageData(io.lang, reviews, await io.host.now(), false, {}), root, io.host.home)
    const t = texts(io.lang)
    const input = { icon: 'code', description: t.page.publishDescription(review.name, review.branch) }
    const publishAt = async (path: string, url: string | null) => {
      await io.write(path, html)
      const answer = await io.artifact({ file_path: path, ...input, ...(url ? { url } : {}) }, t.page.publishConsent).catch(() => undefined)
      return artifactOutcome(answer)
    }
    const name = publishName(review.name, review.branch)
    const known = await publishedUrl(io, review)
    let outcome = await publishAt(`${dir}/publish-${name}.html`, known)
    if (outcome === 'refused' && known) outcome = await publishAt(`${dir}/publish-${name}.html`, null)
    if (outcome === 'refused') {
      const cwd = await io.cwd()
      const copy = `${cwd}/.git/info/intent-publish-${name}.html`
      if ((await io.host.run(['test', '-d', `${cwd}/.git`])).exitCode === 0) {
        run.copies.add(copy)
        outcome = await publishAt(copy, null)
      }
    }
    if (typeof outcome === 'object') {
      await io.host.store.set(publishedKey(root, review.branch), outcome.url)
      run.publishFailed.delete(root)
    } else run.publishFailed.set(root, outcome)
  } catch {
    run.publishFailed.set(root, 'failed') // a page file unreadable, a write refused, a module shape unknown
  } finally {
    run.publishing.delete(root)
  }
  await writePage(io, run, slots)
}

/** session.end: the server stops, a write under way ends (2 s at most), then the session's folder goes, and the copies it left in repos. */
export async function endPage(io: PageIO, run: PageRun): Promise<void> {
  const { dir, server, tried } = run
  const copies = [...run.copies]
  run.server = null
  settle(run, false)
  run.dir = null
  run.tried = false
  run.generation += 1
  run.copies.clear()
  server?.stop()
  if (dir === null || !tried) return
  await Promise.race([run.writes(async () => {}), io.sleep(END_WAIT_MS)])
  if (copies.length > 0) await io.host.run(['rm', '-f', ...copies])
  await io.host.run(['rm', '-rf', dir])
  await io.setPage(null)
}
