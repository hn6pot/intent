import { expect, test } from 'claude-code/testing'
import type { KnownPr, PrInfo, PrRef } from '../../hooks/model'
import { CHECK_MS, groupOf, isPrRoot, keepLinked, linkFolders, mergeKnown, prId, prRefOf, stamped, targetOf, toCheck, withInfo } from '../../hooks/prs/known'

const REF: PrRef = { slug: 'a/b', number: 7 }
const info = (extra: Partial<PrInfo> = {}): PrInfo => ({
  ...REF, title: 'T', state: 'open', url: 'https://github.com/a/b/pull/7',
  headRefName: 'feat/x', headRefOid: 'h1', baseRefName: 'main', baseRefOid: 'b1', ...extra,
})
const known = (extra: Partial<KnownPr> = {}): KnownPr => ({
  ref: REF, opened: false, fromBranch: false, info: null, checkedAt: null, unreachable: false, folder: null, ...extra,
})

test('prId and isPrRoot: pr:<slug>#<n>, a folder is not a PR', () => {
  expect(prId(REF)).toBe('pr:a/b#7')
  expect(isPrRoot('pr:a/b#7')).toBe(true)
  expect(prRefOf('pr:a/b#7')).toEqual(REF)
  expect(isPrRoot('/Users/me/repo')).toBe(false)
  expect(isPrRoot('pr:a/b')).toBe(false)
})

test('mergeKnown: new PRs at the end, one entry per slug#n, opened and fromBranch never back to false', () => {
  const other = { slug: 'a/b', number: 8 }
  let list = mergeKnown([], [{ ref: REF, opened: false }, { ref: other, opened: true }, { ref: REF, opened: false }])
  expect(list.map(pr => pr.ref.number)).toEqual([7, 8])
  expect(list[0]).toEqual(known())
  list = mergeKnown(list, [{ ref: REF, opened: true }, { ref: other, opened: false, fromBranch: true }])
  expect(list.map(pr => [pr.opened, pr.fromBranch])).toEqual([[true, false], [true, true]])
  list = mergeKnown(list, [{ ref: REF, opened: false }, { ref: other, opened: false, fromBranch: false }])
  expect(list.map(pr => [pr.opened, pr.fromBranch])).toEqual([[true, false], [true, true]])
})

test('mergeKnown: the same PR seen by a link and by branchPr is one entry, which keeps what it knew', () => {
  const linked = withInfo(mergeKnown([], [{ ref: REF, opened: false }]), REF, info(), 1000)
  const both = mergeKnown(linked, [{ ref: { slug: 'A/b', number: 7 }, opened: false, fromBranch: true }])
  expect(both).toHaveLength(1)
  expect(both[0]).toMatchObject({ ref: REF, fromBranch: true, info: info(), checkedAt: 1000 })
})

test('groupOf: a pasted link alone is viewed; opened here or the PR of a branch is this conversation', () => {
  const awake = new Set<string>()
  expect(groupOf(known(), awake)).toBe('viewed')
  expect(groupOf(known({ opened: true }), awake)).toBe('conversation')
  expect(groupOf(known({ fromBranch: true }), awake)).toBe('conversation')
})

test('groupOf: a link whose folder only sleeps is viewed, then this conversation once the folder wakes', () => {
  const pr = known({ folder: '/w/tree' })
  expect(groupOf(pr, new Set(['/w/other']))).toBe('viewed')
  expect(groupOf(pr, new Set(['/w/tree']))).toBe('conversation')
})

test('toCheck: never asked, or asked more than 5 minutes ago', () => {
  const now = 1_000_000
  const list = [
    known({ ref: { slug: 'a/b', number: 1 } }),
    known({ ref: { slug: 'a/b', number: 2 }, checkedAt: now }),
    known({ ref: { slug: 'a/b', number: 3 }, checkedAt: now - (CHECK_MS - 1000) }),
    known({ ref: { slug: 'a/b', number: 4 }, checkedAt: now - (CHECK_MS + 1000) }),
  ]
  expect(CHECK_MS).toBe(300_000)
  expect(toCheck(list, now).map(ref => ref.number)).toEqual([1, 4])
})

test('toCheck: a merged or closed PR is not asked again, however old its last ask; an open one is', () => {
  const now = 1_000_000
  const old = now - (CHECK_MS + 1000)
  const list = [
    known({ ref: { slug: 'a/b', number: 1 }, checkedAt: old, info: info({ number: 1, state: 'merged' }) }),
    known({ ref: { slug: 'a/b', number: 2 }, checkedAt: old, info: info({ number: 2, state: 'closed' }) }),
    known({ ref: { slug: 'a/b', number: 3 }, checkedAt: old, info: info({ number: 3, state: 'open' }) }),
    known({ ref: { slug: 'a/b', number: 4 }, checkedAt: old, info: null, unreachable: true }),
  ]
  expect(toCheck(list, now).map(ref => ref.number)).toEqual([3, 4])
})

test('withInfo: the answer and when; null keeps the old info and says unreachable', () => {
  const first = withInfo([known()], REF, info(), 10)
  expect(first[0]).toMatchObject({ info: info(), checkedAt: 10, unreachable: false })
  const failed = withInfo(first, REF, null, 20)
  expect(failed[0]).toMatchObject({ info: info(), checkedAt: 20, unreachable: true })
  const back = withInfo(failed, REF, info({ headRefOid: 'h2' }), 30)
  expect(back[0]).toMatchObject({ checkedAt: 30, unreachable: false, info: { headRefOid: 'h2' } })
  const never = withInfo([known()], REF, null, 5)
  expect(never[0]).toMatchObject({ info: null, unreachable: true })
})

test('linkFolders: the folder of the same slug on the head branch, else null', () => {
  const list = [known({ info: info() }), known({ ref: { slug: 'a/b', number: 9 } })]
  const folders = [
    { root: '/other', slug: 'c/d', branch: 'feat/x' },
    { root: '/main', slug: 'a/b', branch: 'main' },
    { root: '/tree', slug: 'a/b', branch: 'feat/x' },
  ]
  expect(linkFolders(list, folders).map(pr => pr.folder)).toEqual(['/tree', null])
  expect(linkFolders(list, [folders[0]!])[0]!.folder).toBeNull()
  expect(linkFolders([known({ info: info(), folder: '/tree' })], [])[0]!.folder).toBeNull()
})

test('targetOf: the linked folder, else the PR itself', () => {
  expect(targetOf(known({ folder: '/tree' }))).toBe('/tree')
  expect(targetOf(known())).toBe('pr:a/b#7')
})

test('withInfo: an answer older than the last ask is dropped, a newer or equal one kept', () => {
  const fresh = [known({ info: info({ headRefOid: 'h2' }), checkedAt: 20 })]
  expect(withInfo(fresh, REF, info({ headRefOid: 'h1' }), 10)).toEqual(fresh)
  expect(withInfo(fresh, REF, null, 10)).toEqual(fresh)
  expect(withInfo(fresh, REF, info({ headRefOid: 'h3' }), 20)[0]!.info!.headRefOid).toBe('h3')
})

test('stamped: only the PRs asked get their ask time, so toCheck no longer lists them', () => {
  const list = [known(), known({ ref: { slug: 'a/b', number: 8 } })]
  const next = stamped(list, [REF], 1_000)
  expect(next.map(pr => pr.checkedAt)).toEqual([1_000, null])
  expect(toCheck(next, 1_000).map(ref => ref.number)).toEqual([8])
})

test('keepLinked: a PR whose folder is awake joins the conversation for good, one linked to a dormant folder does not', () => {
  const awake = new Set(['/tree'])
  const list = [known({ folder: '/tree' }), known({ ref: { slug: 'a/b', number: 8 }, folder: '/sleep' }), known({ ref: { slug: 'a/b', number: 9 } })]
  const next = keepLinked(list, awake)
  expect(next.map(pr => pr.fromBranch)).toEqual([true, false, false])
  const left = linkFolders(next, [{ root: '/tree', slug: 'a/b', branch: 'other' }])
  expect(groupOf(keepLinked(left, new Set()).find(pr => pr.ref.number === 7)!, new Set())).toBe('conversation')
})
