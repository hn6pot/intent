// The diff of a PR: from the local clone when it has the commits (full context), else from `gh pr diff` (3 lines of context).
import type { Host } from '../host'
import type { Diff, Failure, PrInfo } from '../model'
import { diffOf, rangeDiff } from '../repos/diff'
import { ghEnv } from './gh'

const FETCH_MS = 60_000

/** A git command that works; one that fails or cannot start reads as no. */
async function git(host: Host, clone: string, args: readonly string[]): Promise<string | null> {
  try {
    const r = await host.run(['git', '-C', clone, ...args], { timeoutMs: FETCH_MS })
    return r.exitCode === 0 ? r.stdout : null
  } catch {
    return null
  }
}

/** merge-base..head of the PR from the clone, fetching what is missing once; `null` on any failure or an empty diff. */
async function cloneDiff(host: Host, pr: PrInfo, clone: string, context: number): Promise<{ diff: Diff; base: string } | null> {
  const present = (await git(host, clone, ['cat-file', '-e', `${pr.headRefOid}^{commit}`])) !== null
    && (await git(host, clone, ['cat-file', '-e', `${pr.baseRefOid}^{commit}`])) !== null
  if (!present && (await git(host, clone, ['fetch', '--no-tags', 'origin', `pull/${pr.number}/head`, pr.baseRefName])) === null) return null
  const base = (await git(host, clone, ['merge-base', pr.headRefOid, pr.baseRefOid]))?.trim()
  if (!base) return null
  try {
    const diff = await rangeDiff(host, clone, base, pr.headRefOid, context)
    return 'error' in diff || diff.files.length === 0 ? null : { diff, base }
  } catch {
    return null
  }
}

/** The PR's diff and the commit it starts from; `narrow` when it comes from GitHub (3 lines of context whatever was asked). */
export async function prDiff(
  host: Host,
  pr: PrInfo,
  clone: string | null,
  context: 3 | 10,
): Promise<{ diff: Diff; base: string; narrow: boolean } | { error: Extract<Failure, 'git' | 'truncated' | 'github'> }> {
  if (clone !== null) {
    const local = await cloneDiff(host, pr, clone, context)
    if (local !== null) return { ...local, narrow: false }
  }
  try {
    const r = await host.run(['gh', 'pr', 'diff', String(pr.number), '-R', pr.slug], { env: await ghEnv(host, pr.slug), timeoutMs: FETCH_MS })
    if (r.exitCode !== 0) return { error: 'github' }
    if (r.truncated) return { error: 'truncated' }
    return { diff: diffOf(r.stdout), base: pr.baseRefOid, narrow: true }
  } catch {
    return { error: 'github' }
  }
}
