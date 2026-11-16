// The PRs of a session and the review of one: what is asked to gh and when, and the review kept per head commit.
// No `$` here: register.ts builds the PrIO, as it builds the QuestionIO.
import { originSlug } from '../github/gh'
import { type ConversationMessage, conversationPrs } from '../github/links'
import { branchPr, prDetail, prInfo } from '../github/pr'
import { prDiff } from '../github/pr-diff'
import type { Host } from '../host'
import type { Texts } from '../i18n'
import type { Failure, KnownPr, PrInfo, PrRef, Review, Slot } from '../model'
import { type Complete, generateReview } from '../review/generate'
import { asInferred } from '../review/parse'
import { apply, isDormant, isFolder, newSlot, type SlotEvent } from '../review/slots'
import { codeless, lacksCode, refill } from '../review/stored'
import { CHECK_MS, keepLinked, linkFolders, mergeKnown, prRefOf, samePr, sameSlug, stamped, toCheck, withInfo } from './known'
import { isKeptReview, prReviewKey, prunePrReviews } from './stored'

/** What the PRs need of Claude Code. */
export type PrIO = {
  host: Host
  t: Texts
  slots: () => readonly Slot[]
  /** Replaces the slots, then publishes them. */
  setSlots: (slots: Slot[]) => Promise<void>
  known: () => readonly KnownPr[]
  setKnown: (known: KnownPr[]) => Promise<void>
  messages: () => Promise<readonly ConversationMessage[]>
  complete: Complete
  /** Last ask of a branch's PR, by `<root>\0<branch>`; also each try to give a PR slot its code back, by `refill\0<root>@<head>`. */
  asked: Map<string, number>
  /** PRs whose review is under way: one at a time per PR. */
  busy: Set<string>
  /** The `originSlug` of each followed folder, once read (null: no GitHub origin); the page groups by it. */
  slugs: Map<string, string | null>
  /** A `notePrs` pass is under way: another one returns at once. */
  running: boolean
}

type Followed = { root: string; awake: boolean; slug: string | null; branch: string | null }

/** The branch checked out in `root`; null when git fails or cannot run. */
async function branchOf(host: Host, root: string): Promise<string | null> {
  try {
    const r = await host.run(['git', '-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'])
    return r.exitCode === 0 ? r.stdout.trim() || null : null
  } catch {
    return null
  }
}

/** The followed folders still there (dormant ones included), with their repo (read once) and their branch. */
async function followed(io: PrIO): Promise<Followed[]> {
  const folders = io.slots().filter(s => isFolder(s) && !s.gone)
  return Promise.all(
    folders.map(async slot => {
      if (!io.slugs.has(slot.root)) io.slugs.set(slot.root, await originSlug(io.host, slot.root))
      return { root: slot.root, awake: !isDormant(slot), slug: io.slugs.get(slot.root) ?? null, branch: await branchOf(io.host, slot.root) }
    }),
  )
}

/** Each reviewed PR slot whose head moved on GitHub goes stale: the head decides, never the diff hash (gh and clone diffs differ). */
async function markBehind(io: PrIO, known: readonly KnownPr[]): Promise<void> {
  const behind = (slot: Slot): boolean => {
    if (slot.pr === undefined || slot.review === null || slot.status !== 'idle') return false
    const head = known.find(pr => samePr(pr.ref, slot.pr!))?.info?.headRefOid
    return head !== undefined && head !== slot.pr.head
  }
  if (io.slots().some(behind)) await io.setSlots(io.slots().map(s => (behind(s) ? apply(s, { kind: 'stale' }) : s)))
}

/**
 * Gives back the code of the PR slots restored without it (the store keeps none), from the diff at their own head, with
 * no model call. One try per slot and head: a failing one is not repeated at each pass.
 */
async function refillPrCode(io: PrIO, known: readonly KnownPr[]): Promise<void> {
  for (const { root, pr, review, status } of io.slots()) {
    const info = pr && known.find(k => samePr(k.ref, pr))?.info
    const key = `refill\0${root}@${pr?.head}`
    if (!pr || !info || review === null || status === 'running' || !lacksCode(review) || io.asked.has(key)) continue
    io.asked.set(key, await io.host.now())
    try {
      const fetched = await prDiff(io.host, { ...info, headRefOid: pr.head }, pr.clone, 3)
      if ('error' in fetched) continue
      // Applied to the latest slots: a click made meanwhile stays.
      const slots = io.slots().map(s => {
        const back = s.root === root && s.review !== null ? refill(s.review, fetched.diff.files) : null
        return back !== null && back !== s.review ? { ...s, review: back } : s
      })
      if (slots.some((s, at) => s !== io.slots()[at])) await io.setSlots(slots)
    } catch {
      // This one stays without its code; the others go on.
    }
  }
}

/**
 * The PRs of the conversation, always (it costs nothing); while the pane or the page is watched, also the PR of each
 * awake folder's branch (every 5 minutes per folder and branch), gh's info of the PRs due, their folders, the
 * reviews left behind by a new head, and the code of the PR reviews restored without it. Publishes only what changed; never rejects.
 */
export async function notePrs(io: PrIO, watched: boolean): Promise<void> {
  if (io.running) return
  io.running = true
  try {
    const found: { ref: PrRef; opened: boolean; fromBranch?: boolean }[] = conversationPrs(await io.messages())
    const answers: [PrRef, PrInfo | null, number][] = []
    const withAnswers = (list: KnownPr[]) => answers.reduce((next, [ref, info, at]) => withInfo(next, ref, info, at), list)
    let folders: Followed[] = []
    if (watched) {
      const now = await io.host.now()
      folders = await followed(io)
      for (const { root, awake, branch } of folders) {
        const key = `${root}\0${branch}`
        if (!awake || branch === null || now - (io.asked.get(key) ?? -Infinity) < CHECK_MS) continue
        io.asked.set(key, now)
        const info = await branchPr(io.host, root)
        if (info === null) continue
        const ref = { slug: info.slug, number: info.number }
        found.push({ ref, opened: false, fromBranch: true })
        answers.push([ref, info, now])
      }
      const due = toCheck(withAnswers(mergeKnown(io.known(), found)), now)
      if (due.length > 0) await io.setKnown(stamped(mergeKnown(io.known(), found), due, now)) // asked now: nobody asks them again
      for (const ref of due) answers.push([ref, await prInfo(io.host, ref), now])
    }
    // Applied to the latest list: what a click asked meanwhile stays.
    const before = io.known()
    let known = withAnswers(mergeKnown(before, found))
    if (watched) {
      known = linkFolders(known, folders.flatMap(f => (f.slug !== null && f.branch !== null ? [{ root: f.root, slug: f.slug, branch: f.branch }] : [])))
      known = keepLinked(known, new Set(folders.filter(f => f.awake).map(f => f.root)))
    }
    if (JSON.stringify(known) !== JSON.stringify(before)) await io.setKnown(known)
    if (watched) await markBehind(io, known)
    if (watched) await refillPrCode(io, known)
  } catch {
    // Nothing more this pass: the next one asks again.
  } finally {
    io.running = false
  }
}

/** Fails the PR's slot, made first when something threw before it existed: the page always has a slot to show. */
async function failPr(io: PrIO, id: string, ref: PrRef): Promise<void> {
  const slots = io.slots().some(s => s.root === id) ? io.slots() : [...io.slots(), prSlot(id, ref, '')]
  await io.setSlots(slots.map(s => (s.root === id ? apply(s, { kind: 'failed', error: 'github' }) : s)))
}

async function change(io: PrIO, id: string, event: SlotEvent): Promise<void> {
  await io.setSlots(io.slots().map(s => (s.root === id ? apply(s, event) : s)))
}

/** A new PR slot: no start, no untracked files, named by its number. */
function prSlot(id: string, ref: PrRef, head: string): Slot {
  return { ...newSlot(id, { start: '', preexisting: [] }), name: `#${ref.number}`, start: null, pr: { ...ref, head, clone: null, narrow: false } }
}

/** The followed folder (dormant ones included) of the PR's repo, the one on its head branch first; null without one. */
async function cloneOf(io: PrIO, info: PrInfo): Promise<string | null> {
  const same = (await followed(io)).filter(f => f.slug !== null && sameSlug(f.slug, info.slug))
  return (same.find(f => f.branch === info.headRefName) ?? same[0])?.root ?? null
}

/** Keeps the review without its code, then drops the PR reviews past 50; a refused write only loses the keeping. */
async function keep(host: Host, key: string, review: Review): Promise<void> {
  try {
    await host.store.set(key, codeless(review))
    const keys = (await host.store.keys()).filter(k => k.startsWith('pr:'))
    const entries = await Promise.all(keys.map(async k => [k, (await host.store.get(k)) as Review] as [string, Review]))
    for (const old of prunePrReviews(entries)) await host.store.delete(old)
  } catch {
    // The review still shows; only the keeping is lost.
  }
}

/** The kept review with its code back; null when it cannot be refilled. */
function refilled(kept: Review, files: Parameters<typeof refill>[1]): Review | null {
  try {
    return refill(kept, files)
  } catch {
    return null
  }
}

/** The review kept for this head with its code back (no model call), else a new one, kept. */
async function reviewOf(
  io: PrIO,
  ref: PrRef,
  info: PrInfo,
  clone: string | null,
  opened: boolean,
  previous: Review | null,
): Promise<{ review: Review; narrow: boolean } | { error: Failure }> {
  const key = prReviewKey(ref, info.headRefOid)
  const kept = await io.host.store.get(key).catch(() => undefined)
  const fetched = await prDiff(io.host, info, clone, 3)
  if ('error' in fetched) return fetched
  // A kept value that is not a usable review counts as not kept: a new one overwrites it.
  const back = isKeptReview(kept) ? refilled(kept, fetched.diff.files) : null
  // The rule holds for a kept review too: one made where the PR was opened is only viewed here.
  if (back !== null) return { review: opened ? back : { ...back, intentions: asInferred(back.intentions) }, narrow: fetched.narrow }
  const detail = await prDetail(io.host, ref)
  if (detail === null) return { error: 'github' }
  const transcript = opened ? await io.messages().catch(() => []) : []
  const review = await generateReview(io.complete, {
    t: io.t, repo: info.slug, ref: fetched.base, diff: fetched.diff, transcript, previous, now: await io.host.now(),
    kind: 'pr', pr: detail, inferredOnly: !opened,
  }).catch((): { error: Failure } => ({ error: 'model' }))
  if ('error' in review) return review
  await keep(io.host, key, review)
  return { review, narrow: fetched.narrow }
}

/** A click asks gh again, then shows the PR's review: its slot is made if needed, and fails with why. */
async function reviewPr(io: PrIO, id: string, ref: PrRef): Promise<void> {
  const info = await prInfo(io.host, ref)
  const now = await io.host.now() // before reading the list: it is read and written in one step
  await io.setKnown(withInfo(mergeKnown(io.known(), [{ ref, opened: false }]), ref, info, now))
  if (!io.slots().some(s => s.root === id)) await io.setSlots([...io.slots(), prSlot(id, ref, info?.headRefOid ?? '')])
  if (info === null) return change(io, id, { kind: 'failed', error: 'github' })
  await change(io, id, { kind: 'running' })
  const clone = await cloneOf(io, info)
  const opened = io.known().find(pr => samePr(pr.ref, ref))?.opened ?? false
  const previous = io.slots().find(s => s.root === id)?.review ?? null
  const outcome = await reviewOf(io, ref, info, clone, opened, previous)
  if ('error' in outcome) return change(io, id, { kind: 'failed', error: outcome.error })
  const pr = { ...ref, head: info.headRefOid, clone, narrow: outcome.narrow }
  await io.setSlots(io.slots().map(s => (s.root === id ? { ...apply(s, { kind: 'done', review: outcome.review }), pr } : s)))
}

/** Opens the review of the PR `id` (`pr:<slug>#<n>`); a folder, or a PR already under way, is left alone. Never rejects. */
export async function openPr(io: PrIO, id: string): Promise<void> {
  const ref = prRefOf(id)
  if (ref === null || io.busy.has(id)) return
  io.busy.add(id)
  try {
    await reviewPr(io, id, ref)
  } catch {
    await failPr(io, id, ref).catch(() => undefined)
  } finally {
    io.busy.delete(id)
  }
}
