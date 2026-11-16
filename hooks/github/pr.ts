// Reads a pull request through `gh pr view`: read-only, and `null` on any failure (the caller says "unreachable").
import type { Host } from '../host'
import type { PrDetail, PrInfo, PrRef, PrState } from '../model'
import { ghEnv, ghJson, originSlug } from './gh'

const INFO_FIELDS = 'number,title,state,url,headRefName,headRefOid,baseRefName,baseRefOid'
const DETAIL_FIELDS = `${INFO_FIELDS},body,commits`

type GhPr = {
  number: number
  title: string
  state: string
  url: string
  headRefName: string
  headRefOid: string
  baseRefName: string
  baseRefOid: string
  body?: string
  commits?: { messageHeadline: string; messageBody?: string }[]
}

function toInfo(slug: string, pr: GhPr): PrInfo {
  return {
    slug,
    number: pr.number,
    title: pr.title,
    state: pr.state.toLowerCase() as PrState,
    url: pr.url,
    headRefName: pr.headRefName,
    headRefOid: pr.headRefOid,
    baseRefName: pr.baseRefName,
    baseRefOid: pr.baseRefOid,
  }
}

/** Title, state and the commits of head and base; `null` when `gh` fails or answers nonsense. */
export async function prInfo(host: Host, ref: PrRef): Promise<PrInfo | null> {
  try {
    return toInfo(ref.slug, await ghJson<GhPr>(host, ref.slug, ['pr', 'view', String(ref.number), '--json', INFO_FIELDS]))
  } catch {
    return null
  }
}

/** `prInfo` plus the description and the commit messages (headline, then body when there is one). */
export async function prDetail(host: Host, ref: PrRef): Promise<PrDetail | null> {
  try {
    const pr = await ghJson<GhPr>(host, ref.slug, ['pr', 'view', String(ref.number), '--json', DETAIL_FIELDS])
    const commits = (pr.commits ?? []).map(c => (c.messageBody ? `${c.messageHeadline}\n\n${c.messageBody}` : c.messageHeadline))
    return { ...toInfo(ref.slug, pr), body: pr.body ?? '', commits }
  } catch {
    return null
  }
}

/** The PR of the branch checked out in `root`; `null` without a GitHub origin, without a PR, or when `gh` fails. */
export async function branchPr(host: Host, root: string): Promise<PrInfo | null> {
  const slug = await originSlug(host, root)
  if (slug === null) return null
  try {
    const r = await host.run(['gh', 'pr', 'view', '--json', INFO_FIELDS], { cwd: root, env: await ghEnv(host, slug), timeoutMs: 30_000 })
    return r.exitCode === 0 ? toInfo(slug, JSON.parse(r.stdout) as GhPr) : null
  } catch {
    return null
  }
}
