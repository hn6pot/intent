// Which working folder a touched folder belongs to, and its slot: dormant when only read, woken by a write.
import type { Host } from '../host'
import type { Slot } from '../model'
import { diffBase, nearestFolder, type PrBases, workTree } from '../repos/base'
import { computeDiff, firstChange } from '../repos/diff'
import { apply, isDormant, newSlot } from './slots'

/** What tracking reads and updates: the slots, the folder → working folder cache, the PR bases. */
export type Tracking = { slots: Slot[]; roots: Map<string, string>; prBases: PrBases }

/** The diff hash of a folder as it stands; '' when git fails, so the first diff that reads wakes it. */
async function hashNow(host: Host, known: Tracking, root: string, first: { start: string; preexisting: string[] }): Promise<string> {
  const { base } = await diffBase(host, root, first, known.prBases)
  const diff = await computeDiff(host, root, base, first.preexisting)
  return 'error' in diff ? '' : diff.hash
}

/** The working folder of `folder` with its slot, `changed` when a slot appeared or woke; null outside a repo. */
export async function track(
  host: Host,
  known: Tracking,
  folder: string,
  readOnly: boolean,
): Promise<{ root: string; changed: boolean } | null> {
  const root = known.roots.get(folder) ?? (await workTree(host, await nearestFolder(host, folder)))
  if (!root) return null
  known.roots.set(folder, root)
  const slot = known.slots.find(s => s.root === root)
  if (slot) {
    if (readOnly || !isDormant(slot)) return { root, changed: false }
    known.slots = known.slots.map(s => (s.root === root ? apply(s, { kind: 'wake' }) : s))
    return { root, changed: true }
  }
  // A folder's starting point and its untracked files are those before its first change.
  const first = await firstChange(host, root)
  const dormant = readOnly ? await hashNow(host, known, root, first) : null
  if (known.slots.some(s => s.root === root)) return track(host, known, folder, readOnly) // registered meanwhile
  known.slots = [...known.slots, newSlot(root, first, dormant)]
  return { root, changed: true }
}
