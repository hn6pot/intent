import { expect, test } from 'claude-code/testing'
import type { KnownPr, PrInfo, Review, Slot } from '../../hooks/model'
import { pageSources } from '../../hooks/page/sources'

const slot = (root: string, extra: Partial<Slot> = {}): Slot => ({
  root, name: root.split('/').pop()!, start: 'abc', preexisting: [], resetStart: false, diffHash: null, review: null, status: 'idle', error: null,
  empty: false, gone: false, dormant: null, answers: [], ...extra,
})
const review = {} as Review
const prSlot = (slug: string, number: number, extra: Partial<Slot> = {}): Slot =>
  slot(`pr:${slug}#${number}`, { pr: { slug, number, head: 'h', clone: null, narrow: false }, ...extra })

const info = (slug: string, number: number, extra: Partial<PrInfo> = {}): PrInfo => ({
  slug, number, title: `PR ${number}`, state: 'open', url: `https://github.com/${slug}/pull/${number}`,
  headRefName: 'feat/x', headRefOid: 'h1', baseRefName: 'main', baseRefOid: 'b1', ...extra,
})
const known = (slug: string, number: number, extra: Partial<KnownPr> = {}): KnownPr => ({
  ref: { slug, number }, opened: false, fromBranch: false, info: info(slug, number), checkedAt: 1, unreachable: false, folder: null, ...extra,
})

const SLUGS = new Map<string, string | null>([['/w/app', 'a/app'], ['/w/app-tree', 'A/App'], ['/w/notes', null]])

test('two folders of the same repo are one group, their branches listed in the folders order', () => {
  const slots = [slot('/w/app'), slot('/w/notes'), slot('/w/app-tree')]
  const sources = pageSources(slots, [], SLUGS, { '/w/app': 'main', '/w/app-tree': 'feat/x', '/w/notes': 'main' })
  expect(sources.map(s => s.repo)).toEqual(['a/app', 'notes'])
  expect(sources[0]!.branches).toEqual([
    { root: '/w/app', name: 'app', branch: 'main' },
    { root: '/w/app-tree', name: 'app-tree', branch: 'feat/x' },
  ])
  expect(sources[1]).toEqual({ repo: 'notes', branches: [{ root: '/w/notes', name: 'notes', branch: 'main' }], prs: [] })
})

test('a sleeping folder is no branch of the group; a repo without anything to show has no group', () => {
  const slots = [slot('/w/app', { dormant: 'h' }), slot('/w/notes', { dormant: 'h' })]
  expect(pageSources(slots, [], SLUGS, { '/w/app': 'main', '/w/notes': 'main' })).toEqual([])
})

test('the PRs of a repo, newest number first, each with its group and its target', () => {
  const slots = [slot('/w/app')]
  const list = [
    known('a/app', 3, { opened: true }),
    known('A/app', 9),
    known('a/app', 5, { folder: '/w/app' }), // the folder's branch: its click opens the folder
  ]
  const [group] = pageSources(slots, list, SLUGS, { '/w/app': 'feat/x' })
  expect(group!.prs.map(pr => [pr.number, pr.group, pr.target])).toEqual([
    [9, 'viewed', 'pr:A/app#9'],
    [5, 'conversation', '/w/app'],
    [3, 'conversation', 'pr:a/app#3'],
  ])
  expect(group!.prs[0]).toMatchObject({ title: 'PR 9', state: 'open', url: 'https://github.com/A/app/pull/9', reviewed: false, behind: false })
})

test('a PR linked to a sleeping folder is viewed, then this conversation once the folder is awake', () => {
  const list = [known('a/app', 5, { folder: '/w/app' })]
  expect(pageSources([slot('/w/app', { dormant: 'h' })], list, SLUGS, {})[0]!.prs[0]!.group).toBe('viewed')
  expect(pageSources([slot('/w/app')], list, SLUGS, {})[0]!.prs[0]!.group).toBe('conversation')
})

test('a PR of a repo no folder follows has its own group, after the folders', () => {
  const sources = pageSources([slot('/w/app')], [known('x/other', 2), known('a/app', 1)], SLUGS, { '/w/app': 'main' })
  expect(sources.map(s => s.repo)).toEqual(['a/app', 'x/other'])
  expect(sources[1]).toEqual({ repo: 'x/other', branches: [], prs: [expect.objectContaining({ number: 2, target: 'pr:x/other#2', group: 'viewed' })] })
})

test('reviewed: its folder or its own slot holds a review; behind: its own slot is stale', () => {
  const slots = [
    slot('/w/app', { review }),
    prSlot('a/app', 7, { review, status: 'stale' }),
    prSlot('a/app', 8, { review }),
    prSlot('a/app', 9), // a slot, no review yet
  ]
  const list = [known('a/app', 5, { folder: '/w/app' }), known('a/app', 6), ...[7, 8, 9, 10].map(n => known('a/app', n))]
  const prs = pageSources(slots, list, SLUGS, { '/w/app': 'feat/x' })[0]!.prs
  const flags = Object.fromEntries(prs.map(pr => [pr.number, [pr.reviewed, pr.behind]]))
  expect(flags).toEqual({ 5: [true, false], 6: [false, false], 7: [true, true], 8: [true, false], 9: [false, false], 10: [false, false] })
})

test('a PR gh never answered for has no title and no state, and its address is guessed from its slug', () => {
  const [group] = pageSources([], [known('a/app', 4, { info: null, unreachable: true })], SLUGS, {})
  expect(group!.prs[0]).toMatchObject({ title: '', state: null, url: 'https://github.com/a/app/pull/4' })
})
