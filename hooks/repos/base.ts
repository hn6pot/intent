// Where a review starts: the merge-base with the branch's base, or the remembered start on the default branch.
import type { Host, RunOptions } from '../host'
import type { Slot } from '../model'
import { join, parent } from '../paths'
import { ghEnv, slugFromUrl } from '../github/gh'
import { EMPTY_TREE } from './diff'

async function git(host: Host, root: string, args: readonly string[]): Promise<string | null> {
  const r = await host.run(['git', '-C', root, ...args])
  return r.exitCode === 0 ? r.stdout.trim() : null
}

/** The folder itself, or its nearest existing parent: a Write may create the folders on its way. */
export async function nearestFolder(host: Host, folder: string): Promise<string> {
  let current = folder
  while (current !== '/' && (await host.run(['test', '-d', current])).exitCode !== 0) current = parent(current)
  return current
}

/** Top level of the repo containing `folder`; `null` when the folder is gone or outside a repo. */
export async function workTree(host: Host, folder: string): Promise<string | null> {
  const top = await git(host, folder, ['rev-parse', '--show-toplevel'])
  return top === '' ? null : top
}

async function rebaseInProgress(host: Host, root: string): Promise<boolean> {
  for (const name of ['rebase-merge', 'rebase-apply']) {
    const path = await git(host, root, ['rev-parse', '--git-path', name])
    if (!path) continue
    if ((await host.run(['test', '-d', join(root, path, host.home)])).exitCode === 0) return true
  }
  return false
}

/** `gh` runs with the gh account of the repo's owner (see `ghEnv`), without touching the active account. */
async function ghOptions(host: Host, root: string): Promise<RunOptions> {
  const origin = await git(host, root, ['remote', 'get-url', 'origin'])
  const slug = origin === null ? null : slugFromUrl(origin)
  const env = slug === null ? undefined : await ghEnv(host, slug)
  return { cwd: root, timeoutMs: 30_000, ...(env ? { env } : {}) }
}

/** The PR base by `<root>\0<branch>`, kept once `gh` named it: it rarely moves, and it is a network call. */
export type PrBases = Map<string, string>

/** No PR, `gh` missing or slower than its timeout: `null`, asked again next time (a PR may come). */
async function prBase(host: Host, root: string, branch: string, known: PrBases): Promise<string | null> {
  const key = `${root}\0${branch}`
  const kept = known.get(key)
  if (kept !== undefined) return kept
  try {
    const pr = await host.run(['gh', 'pr', 'view', '--json', 'baseRefName', '-q', '.baseRefName'], await ghOptions(host, root))
    const base = pr.stdout.trim()
    if (pr.exitCode !== 0 || base === '') return null
    known.set(key, base)
    return base
  } catch {
    return null
  }
}

async function baseBranch(host: Host, root: string, branch: string, known: PrBases): Promise<string | null> {
  const pr = await prBase(host, root, branch, known)
  if (pr) return pr
  const head = await git(host, root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  return head ? head.replace(/^origin\//, '') : null
}

export async function diffBase(
  host: Host,
  root: string,
  slot: Pick<Slot, 'start'>,
  known: PrBases = new Map(),
): Promise<{ base: string; mode: 'branch' | 'default' }> {
  const fallback = { base: slot.start ?? EMPTY_TREE, mode: 'default' as const }
  const branch = await git(host, root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (!branch || branch === 'HEAD' || (await rebaseInProgress(host, root))) return fallback

  const base = await baseBranch(host, root, branch, known)
  if (!base || base === branch) return fallback

  const mergeBase = await git(host, root, ['merge-base', 'HEAD', `origin/${base}`])
  return mergeBase ? { base: mergeBase, mode: 'branch' } : fallback
}
