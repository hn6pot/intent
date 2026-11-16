// The PRs a session knows: one entry per PR, what gh last said of it, its group and the folder it opens.
import type { KnownPr, PrGroup, PrInfo, PrRef } from '../model'

/** A PR's info is asked again at most every 5 minutes; a branch's PR too. */
export const CHECK_MS = 300_000

const PR_ROOT = /^pr:([\w.-]+\/[\w.-]+)#(\d+)$/

/** The root of a PR slot: `pr:<slug>#<n>`. */
export const prId = (ref: PrRef): string => `pr:${ref.slug}#${ref.number}`

/** The PR a `pr:<slug>#<n>` root names; null for a folder. */
export function prRefOf(root: string): PrRef | null {
  const match = PR_ROOT.exec(root)
  return match ? { slug: match[1]!, number: Number(match[2]) } : null
}

export const isPrRoot = (root: string): boolean => prRefOf(root) !== null

/** GitHub slugs ignore case: a link and an origin may write the owner differently. */
export const sameSlug = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
export const samePr = (a: PrRef, b: PrRef): boolean => a.number === b.number && sameSlug(a.slug, b.slug)

/** New PRs go at the end; one entry per PR; `opened` and `fromBranch` never go back to false. */
export function mergeKnown(known: readonly KnownPr[], found: readonly { ref: PrRef; opened: boolean; fromBranch?: boolean }[]): KnownPr[] {
  const next = [...known]
  for (const { ref, opened, fromBranch = false } of found) {
    const at = next.findIndex(pr => samePr(pr.ref, ref))
    if (at === -1) {
      next.push({ ref, opened, fromBranch, info: null, checkedAt: null, unreachable: false, folder: null })
    } else if ((opened && !next[at]!.opened) || (fromBranch && !next[at]!.fromBranch)) {
      next[at] = { ...next[at]!, opened: next[at]!.opened || opened, fromBranch: next[at]!.fromBranch || fromBranch }
    }
  }
  return next
}

/** This conversation's: opened here, the PR of a branch, or linked to an awake folder (`awake`: their roots); else viewed. */
export function groupOf(pr: KnownPr, awake: ReadonlySet<string>): PrGroup {
  return pr.opened || pr.fromBranch || (pr.folder !== null && awake.has(pr.folder)) ? 'conversation' : 'viewed'
}

/** The PRs never asked, or asked more than 5 minutes ago; a merged or closed one is not asked again on its own (a click asks). */
export function toCheck(known: readonly KnownPr[], now: number): PrRef[] {
  const over = (pr: KnownPr) => pr.info?.state === 'merged' || pr.info?.state === 'closed'
  return known.filter(pr => (pr.checkedAt === null || now - pr.checkedAt > CHECK_MS) && !over(pr)).map(pr => pr.ref)
}

/** What gh said of `ref`, asked at `now`; `null` (unreachable) keeps the info it had; an answer older than the entry's last ask is dropped. */
export function withInfo(known: readonly KnownPr[], ref: PrRef, info: PrInfo | null, now: number): KnownPr[] {
  return known.map(pr => {
    if (!samePr(pr.ref, ref) || (pr.checkedAt !== null && now < pr.checkedAt)) return pr
    return { ...pr, info: info ?? pr.info, checkedAt: now, unreachable: info === null }
  })
}

/** The PRs of `refs` marked as asked at `now`, before gh answers, so a second pass does not ask again. */
export function stamped(known: readonly KnownPr[], refs: readonly PrRef[], now: number): KnownPr[] {
  return known.map(pr => (refs.some(ref => samePr(ref, pr.ref)) ? { ...pr, checkedAt: now } : pr))
}

/** A PR linked to an awake folder is the conversation's for good: `fromBranch` stays true if the folder later moves on or goes. */
export function keepLinked(known: readonly KnownPr[], awake: ReadonlySet<string>): KnownPr[] {
  return known.map(pr => (!pr.fromBranch && pr.folder !== null && awake.has(pr.folder) ? { ...pr, fromBranch: true } : pr))
}

/** Each PR's folder: the followed folder of the same repo whose branch is the PR's head, else null. */
export function linkFolders(known: readonly KnownPr[], folders: readonly { root: string; slug: string; branch: string }[]): KnownPr[] {
  return known.map(pr => {
    const head = pr.info?.headRefName
    const folder = folders.find(f => sameSlug(f.slug, pr.ref.slug) && f.branch === head)?.root ?? null
    return folder === pr.folder ? pr : { ...pr, folder }
  })
}

/** What a click on the PR opens: its folder's review, else its own. */
export const targetOf = (pr: KnownPr): string => pr.folder ?? prId(pr.ref)
