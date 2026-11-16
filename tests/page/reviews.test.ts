import { expect, test } from 'claude-code/testing'
import type { KnownPr, PrInfo, Review, Slot } from '../../hooks/model'
import { pageReviews, type WideDiffs } from '../../hooks/page/reviews'
import { fakeHost } from '../helpers/fake-host'

const HUNK = '@@ -1,2 +1,3 @@'
const DIFF = `diff --git a/a.ts b/a.ts\nindex 1..2 100644\n--- a/a.ts\n+++ b/a.ts\n${HUNK}\n x\n+y\n z\n`

const review: Review = {
  source: { kind: 'conversation', repo: '/r', ref: 'base1' },
  diffHash: 'h1',
  summary: 'Résumé',
  intentions: [],
  files: [{ path: 'a.ts', role: 'Rôle', importance: 'key', status: 'modified', changes: [{ hunk: HUNK, lines: [1, 3], intention: null, explanation: 'Ajoute y', text: '' }] }],
  skipped: [],
  generatedAt: '2026-10-18T10:00:00.000Z',
}
const slot = (extra: Partial<Slot> = {}): Slot => ({
  root: '/r', name: 'r', start: 's0', preexisting: ['old.txt'], resetStart: false, diffHash: 'h1',
  review, status: 'idle', error: null, empty: false, gone: false, dormant: null, answers: [], ...extra,
})

const git = (branch = 'feat/x\n', diffExit = 0) =>
  fakeHost([
    [/rev-parse --abbrev-ref HEAD/, { stdout: branch }],
    [/ diff .*-U10 .* base1$/, { stdout: DIFF, exitCode: diffExit }],
    [/ls-files/, { stdout: '' }],
  ])

test("an awake folder with a review: its diff at 10 lines from the review's starting point, and its branch", async () => {
  const { host, calls } = git()
  const [page] = await pageReviews(host, [slot()], new Map(), [])
  expect(calls.map(c => c.line)).toContain('git -c core.quotepath=off -C /r diff --no-color --no-ext-diff --find-renames -U10 --src-prefix=a/ --dst-prefix=b/ base1')
  expect(page).toMatchObject({ root: '/r', branch: 'feat/x', summary: 'Résumé' })
  expect(page!.files[0]!.hunks[0]!.notes[0]!.explanation).toBe('Ajoute y')
})

test('folders only read, deleted folders, and folders without a review and nothing under way are left out', async () => {
  const { host, calls } = git()
  expect(await pageReviews(host, [slot({ dormant: 'd' }), slot({ gone: true }), slot({ review: null })], new Map(), [])).toEqual([])
  expect(calls).toEqual([])
})

test('a diff that became empty: the folder is sent with no review content, as the pane says « Aucun changement »', async () => {
  const { host, calls } = git()
  const [page] = await pageReviews(host, [slot({ empty: true, diffHash: null })], new Map(), [])
  expect(page).toMatchObject({ root: '/r', branch: 'feat/x', status: 'idle', summary: '', intentions: [], chapters: [], files: [], skipped: [] })
  expect(calls.filter(c => / diff /.test(c.line))).toEqual([])
})

test('the first review under way or failed: the folder is sent with its status and no review content', async () => {
  const { host } = git()
  const reviews = await pageReviews(host, [slot({ review: null, status: 'running' }), slot({ root: '/s', review: null, status: 'failed', error: 'model' })], new Map(), [])
  expect(reviews).toMatchObject([
    { root: '/r', status: 'running', error: null, summary: '', files: [], chapters: [] },
    { root: '/s', status: 'failed', error: 'model', summary: '', files: [], chapters: [] },
  ])
})

test('the wide diff is computed again only when the diff hash changes', async () => {
  const { host, calls } = git()
  const wide: WideDiffs = new Map()
  const diffs = () => calls.filter(c => / diff /.test(c.line)).length
  await pageReviews(host, [slot()], wide, [])
  await pageReviews(host, [slot({ status: 'stale' })], wide, [])
  expect(diffs()).toBe(1)
  await pageReviews(host, [slot({ diffHash: 'h2' })], wide, [])
  expect(diffs()).toBe(2)
})

test('a detached HEAD, or a rev-parse that fails: the branch reads HEAD', async () => {
  expect((await pageReviews(git('HEAD\n').host, [slot()], new Map(), []))[0]!.branch).toBe('HEAD')
  const { host } = fakeHost([[/ diff /, { stdout: DIFF }], [/ls-files/, { stdout: '' }]])
  expect((await pageReviews(host, [slot()], new Map(), []))[0]!.branch).toBe('HEAD')
})

test('a wide diff that fails keeps the last one, and is tried again next time', async () => {
  const wide: WideDiffs = new Map()
  await pageReviews(git().host, [slot()], wide, [])
  const failing = git('feat/x\n', 128)
  const [page] = await pageReviews(failing.host, [slot({ diffHash: 'h2' })], wide, [])
  expect(page!.files[0]!.hunks).toHaveLength(1)
  await pageReviews(failing.host, [slot({ diffHash: 'h2' })], wide, [])
  expect(failing.calls.filter(c => / diff /.test(c.line))).toHaveLength(2)
})

test("the folder's answers go to the page (review.json), placed by file and lines", async () => {
  const { host } = git()
  const done = { id: 'a-1', key: 'k', kind: 'here' as const, path: 'a.ts', lines: [1, 3] as [number, number], question: 'q', answer: 'Voici.', status: 'done' as const, error: null, at: '2026-10-19T10:00:00.000Z' }
  const [page] = await pageReviews(host, [slot({ answers: [done] })], new Map(), [])
  expect(page!.answers).toEqual([{ id: 'a-1', kind: 'here', path: 'a.ts', lines: [1, 3], question: 'q', answer: 'Voici.', status: 'done', error: null, at: done.at, moved: false }])
})

test('an answer whose lines no hunk of its file holds any more is marked moved; a free one never is', async () => {
  const { host } = git()
  const base = { key: 'k', question: 'q', answer: 'Voici.', status: 'done' as const, error: null, at: '2026-10-19T10:00:00.000Z' }
  const answers = [
    { ...base, id: 'a-1', kind: 'selection' as const, path: 'a.ts', lines: [40, 42] as [number, number] },
    { ...base, id: 'a-2', kind: 'here' as const, path: 'gone.ts', lines: [1, 3] as [number, number] },
    { ...base, id: 'a-3', kind: 'free' as const },
  ]
  const [page] = await pageReviews(host, [slot({ answers })], new Map(), [])
  expect(page!.answers.map(a => [a.id, a.moved])).toEqual([['a-1', true], ['a-2', true], ['a-3', false]])
})

const INFO: PrInfo = {
  slug: 'a/b', number: 7, title: 'Fix the thing', state: 'open', url: 'https://github.com/a/b/pull/7',
  headRefName: 'feat/y', headRefOid: 'head1', baseRefName: 'main', baseRefOid: 'base1',
}
const known = (extra: Partial<KnownPr> = {}): KnownPr => ({
  ref: { slug: 'a/b', number: 7 }, opened: false, fromBranch: false, info: INFO, checkedAt: 0, unreachable: false, folder: null, ...extra,
})
const prSlot = (clone: string | null = '/c', extra: Partial<Slot> = {}): Slot =>
  slot({ root: 'pr:a/b#7', name: '#7', start: null, preexisting: [], pr: { slug: 'a/b', number: 7, head: 'head1', clone, narrow: false }, ...extra })
const prHost = () =>
  fakeHost([
    [/cat-file -e/, { stdout: '' }],
    [/merge-base head1 base1/, { stdout: 'mb1\n' }],
    [/ diff .*-U10 .* mb1 head1$/, { stdout: DIFF }],
    [/^gh pr diff 7 -R a\/b$/, { stdout: DIFF }],
  ])

test("a PR slot: its diff at 10 lines from the clone, the PR's head branch, and the PR with its title and state", async () => {
  const { host, calls } = prHost()
  const [page] = await pageReviews(host, [prSlot()], new Map(), [known()])
  expect(page).toMatchObject({
    root: 'pr:a/b#7', branch: 'feat/y', summary: 'Résumé',
    pr: { number: 7, title: 'Fix the thing', state: 'open', url: 'https://github.com/a/b/pull/7', narrow: false },
  })
  expect(page!.files[0]!.hunks[0]!.notes[0]!.explanation).toBe('Ajoute y')
  expect(calls.some(c => /rev-parse --abbrev-ref/.test(c.line))).toBe(false) // a PR has no folder to read a branch from
})

test('a PR slot without a clone: the diff comes from GitHub, narrow, and the page is told', async () => {
  const { host, calls } = prHost()
  const [page] = await pageReviews(host, [prSlot(null)], new Map(), [known()])
  expect(page!.pr).toMatchObject({ number: 7, narrow: true })
  expect(page!.files[0]!.hunks).toHaveLength(1)
  expect(calls.some(c => /^gh pr diff 7/.test(c.line))).toBe(true)
})

test('the PR diff is the reviewed head, even when GitHub says the head moved; computed again only when the diff hash changes', async () => {
  const { host, calls } = prHost()
  const wide: WideDiffs = new Map()
  const moved = [known({ info: { ...INFO, headRefOid: 'head2' } })]
  await pageReviews(host, [prSlot()], wide, moved)
  await pageReviews(host, [prSlot('/c', { status: 'stale' })], wide, moved)
  const diffs = () => calls.filter(c => / diff .*-U10 /.test(c.line))
  expect(diffs()).toHaveLength(1)
  expect(diffs()[0]!.line).toMatch(/mb1 head1$/)
  await pageReviews(host, [prSlot('/c', { diffHash: 'h2' })], wide, moved)
  expect(diffs()).toHaveLength(2)
})

test("a PR GitHub never answered for: the page still gets the PR's number and address, no title, no code", async () => {
  const { host, calls } = prHost()
  const [page] = await pageReviews(host, [prSlot()], new Map(), [])
  expect(page).toMatchObject({ branch: 'HEAD', pr: { number: 7, title: '', state: null, url: 'https://github.com/a/b/pull/7', narrow: false } })
  expect(page!.files.flatMap(f => f.hunks)).toEqual([]) // the review's files stay, with no code around them
  expect(calls).toEqual([])
})

test("a folder linked to a known PR: the page gets the PR, with a diff that is not narrow; any other folder gets none", async () => {
  const { host } = git()
  const linked = await pageReviews(host, [slot()], new Map(), [known({ folder: '/r' })])
  expect(linked[0]!.pr).toEqual({ number: 7, title: 'Fix the thing', state: 'open', url: 'https://github.com/a/b/pull/7', narrow: false })
  expect(linked[0]!.branch).toBe('feat/x') // a folder keeps the branch it has checked out
  expect((await pageReviews(host, [slot()], new Map(), [known({ folder: '/elsewhere' })]))[0]!.pr).toBeNull()
  expect((await pageReviews(host, [slot()], new Map(), [known()]))[0]!.pr).toBeNull()
})
