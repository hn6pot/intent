// The reviews the page shows: each awake folder and each reviewed PR with a review, with its diff at 10 lines of context and
// its branch; a folder whose diff became empty, or whose first review is under way or failed, with its status and no review content.
import { pageAnswers } from '../agents/anchor'
import { prDiff } from '../github/pr-diff'
import type { Host } from '../host'
import type { DiffFile, KnownPr, PagePr, PageReview, PrInfo, PrSource, Review, Slot } from '../model'
import { samePr } from '../prs/known'
import { computeDiff } from '../repos/diff'
import { isDormant } from '../review/slots'
import { pageReview } from './data'

const PAGE_CONTEXT = 10

/** The wide diff per folder or PR, with the diff hash of the review it was computed for; `narrow`: a PR's came from GitHub, 3 lines of context. */
export type WideDiffs = Map<string, { hash: string | null; files: DiffFile[]; narrow?: boolean }>

/** `known` gives a PR slot its title and head, and a folder the PR linked to its branch. */
export async function pageReviews(host: Host, slots: readonly Slot[], wide: WideDiffs, known: readonly KnownPr[]): Promise<PageReview[]> {
  const reviews: PageReview[] = []
  for (const slot of slots) {
    if (isDormant(slot) || slot.gone) continue
    // An empty diff keeps the last review in the slot: the page, like the pane, says there is nothing to explain.
    const review = slot.empty ? null : slot.review
    if (!review && !slot.empty && slot.status === 'idle') continue
    const { pr } = slot
    const info = (pr === undefined ? known.find(k => k.folder === slot.root) : known.find(k => samePr(k.ref, pr)))?.info ?? null
    const files = !review ? [] : pr === undefined ? await wideDiff(host, slot, review, wide) : await prWideDiff(host, slot, pr, info, wide)
    const branch = pr === undefined ? await branchOf(host, slot.root) : info?.headRefName ?? 'HEAD'
    const page = pageReview({ ...slot, review }, files, branch, pagePr(slot, info, wide))
    reviews.push({ ...page, answers: pageAnswers(slot.answers, page) })
  }
  return reviews
}

/** The PR of a PR slot (even one gh never answered for), or the PR linked to a folder's branch; null for a folder without one. */
function pagePr(slot: Slot, info: PrInfo | null, wide: WideDiffs): PagePr | null {
  if (slot.pr === undefined) {
    return info === null ? null : { number: info.number, title: info.title, state: info.state, url: info.url, narrow: false }
  }
  const { slug, number } = slot.pr
  return {
    number, title: info?.title ?? '', state: info?.state ?? null, url: info?.url ?? `https://github.com/${slug}/pull/${number}`,
    narrow: wide.get(slot.root)?.narrow ?? slot.pr.narrow,
  }
}

/** The reviewed head's diff, whatever head GitHub says the PR has now; again only when the diff hash changed; a failure keeps the last one. */
async function prWideDiff(host: Host, slot: Slot, pr: PrSource, info: PrInfo | null, wide: WideDiffs): Promise<DiffFile[]> {
  const kept = wide.get(slot.root)
  if (kept && kept.hash === slot.diffHash) return kept.files
  if (info === null) return kept?.files ?? []
  const diff = await prDiff(host, { ...info, headRefOid: pr.head }, pr.clone, PAGE_CONTEXT)
  if ('error' in diff) return kept?.files ?? []
  wide.set(slot.root, { hash: slot.diffHash, files: diff.diff.files, narrow: diff.narrow })
  return diff.diff.files
}

/** From the review's own starting point, again only when its diff changed; a failure keeps the last one and tries again next time. */
async function wideDiff(host: Host, slot: Slot, review: Review, wide: WideDiffs): Promise<DiffFile[]> {
  const kept = wide.get(slot.root)
  if (kept && kept.hash === slot.diffHash) return kept.files
  const diff = await computeDiff(host, slot.root, review.source.ref, slot.preexisting, PAGE_CONTEXT)
  if ('error' in diff) return kept?.files ?? []
  // Its hash and size are left aside: the fingerprint stays on the 3-line diff.
  wide.set(slot.root, { hash: slot.diffHash, files: diff.files })
  return diff.files
}

/** The branch name; `HEAD` when detached or unknown. */
async function branchOf(host: Host, root: string): Promise<string> {
  const r = await host.run(['git', '-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'])
  const name = r.stdout.trim()
  return r.exitCode === 0 && name !== '' ? name : 'HEAD'
}
