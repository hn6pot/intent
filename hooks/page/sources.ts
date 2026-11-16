// The Sources column's data: per repo, the awake folders and the PRs of the session, each PR with its group, what a click opens, and whether it has a review.
import type { KnownPr, PageSource, Slot } from '../model'
import { groupOf, samePr, targetOf } from '../prs/known'
import { isDormant, isFolder } from '../review/slots'

type Group = PageSource & { key: string }

/** `slugs`: the GitHub slug of each followed folder (null: no GitHub origin); `branches`: the branch of each folder shown. Empty groups are left out. */
export function pageSources(
  slots: readonly Slot[], known: readonly KnownPr[], slugs: ReadonlyMap<string, string | null>, branches: Readonly<Record<string, string>>,
): PageSource[] {
  const groups: Group[] = []
  const groupOfRepo = (key: string, repo: string): Group => {
    let group = groups.find(g => g.key === key)
    if (!group) groups.push((group = { key, repo, branches: [], prs: [] }))
    return group
  }
  const folders = slots.filter(isFolder)
  const awake = new Set(folders.filter(slot => !isDormant(slot)).map(slot => slot.root))
  for (const slot of folders) {
    const slug = slugs.get(slot.root) ?? null
    const group = slug === null ? groupOfRepo(`dir:${slot.root}`, slot.name) : groupOfRepo(`slug:${slug.toLowerCase()}`, slug)
    const branch = branches[slot.root]
    if (awake.has(slot.root) && branch !== undefined) group.branches.push({ root: slot.root, name: slot.name, branch })
  }
  for (const pr of [...known].sort((a, b) => b.ref.number - a.ref.number)) {
    const { slug, number } = pr.ref
    const target = targetOf(pr)
    groupOfRepo(`slug:${slug.toLowerCase()}`, slug).prs.push({
      number,
      title: pr.info?.title ?? '',
      state: pr.info?.state ?? null,
      url: pr.info?.url ?? `https://github.com/${slug}/pull/${number}`,
      group: groupOf(pr, awake),
      target,
      reviewed: slots.some(slot => slot.root === target && slot.review !== null),
      behind: slots.some(slot => slot.pr !== undefined && samePr(slot.pr, pr.ref) && slot.status === 'stale'),
    })
  }
  return groups.filter(group => group.branches.length > 0 || group.prs.length > 0).map(({ key: _key, ...source }) => source)
}
