import { expect, test } from 'claude-code/testing'
import type { PrInfo } from '../../hooks/model'
import { prDiff } from '../../hooks/github/pr-diff'
import { ACME_ACCOUNT, LIGHTHOUSE_CONFIG } from '../helpers/accounts'
import { fakeHost } from '../helpers/fake-host'

const PR: PrInfo = {
  slug: 'a/b', number: 7, title: 'T', state: 'open', url: 'https://github.com/a/b/pull/7',
  headRefName: 'feat', headRefOid: 'head1', baseRefName: 'main', baseRefOid: 'base1',
}
const CLONE = (text: string) => `diff --git a/a.ts b/a.ts
index 1..2 100644
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-x
+${text}
`
const GH = CLONE('from-gh')

const present = [
  [/cat-file -e head1\^\{commit\}$/, {}],
  [/cat-file -e base1\^\{commit\}$/, {}],
  [/merge-base head1 base1$/, { stdout: 'mb1\n' }],
  [/ diff --no-color --no-ext-diff --find-renames -U3 .* mb1 head1$/, { stdout: CLONE('from-clone') }],
] as [RegExp, never][]
const gh = [[/^gh pr diff 7 -R a\/b$/, { stdout: GH }]] as [RegExp, never][]

test('objects already there: no fetch, the diff of merge-base..head from the clone', async () => {
  const { host, calls } = fakeHost([...present, ...gh])
  const r = await prDiff(host, PR, '/c', 3)
  if ('error' in r) throw new Error(r.error)
  expect(r.narrow).toBe(false)
  expect(r.base).toBe('mb1')
  expect(r.diff.files.map(f => f.path)).toEqual(['a.ts'])
  expect(calls.some(c => c.line.includes(' fetch '))).toBe(false)
  expect(calls.some(c => c.line.startsWith('gh '))).toBe(false)
})

test('the context goes to the clone diff', async () => {
  const { host, calls } = fakeHost([
    ...present.slice(0, 3),
    [/ -U10 .* mb1 head1$/, { stdout: CLONE('wide') }],
  ] as [RegExp, never][])
  const r = await prDiff(host, PR, '/c', 10)
  expect('diff' in r && !r.narrow).toBe(true)
  expect(calls[calls.length - 1].line).toContain('-U10')
})

test('head missing: one fetch of pull/7/head and the base branch (60 s), then the diff', async () => {
  let fetched = false
  const { host, calls } = fakeHost([
    [/cat-file -e head1/, () => (fetched ? {} : { exitCode: 128 })],
    [/ fetch /, () => { fetched = true; return {} }],
    ...present.slice(1),
  ] as [RegExp, never][])
  const r = await prDiff(host, PR, '/c', 3)
  expect('diff' in r && !r.narrow).toBe(true)
  const fetches = calls.filter(c => c.line.includes(' fetch '))
  expect(fetches.map(c => c.line)).toEqual(['git -C /c fetch --no-tags origin pull/7/head main'])
  expect(fetches[0].options?.timeoutMs).toBe(60_000)
})

test('a missing base alone also fetches, once', async () => {
  const { host, calls } = fakeHost([
    [/cat-file -e base1/, { exitCode: 128 }],
    [/ fetch /, {}],
    ...present.filter(([p]) => !p.source.includes('base1\\^') ),
  ] as [RegExp, never][])
  await prDiff(host, PR, '/c', 3)
  expect(calls.filter(c => c.line.includes(' fetch '))).toHaveLength(1)
})

test('a failing fetch: gh pr diff of that account, narrow, base is the PR base', async () => {
  const { host, calls } = fakeHost([
    [/cat-file -e head1/, { exitCode: 128 }],
    [/ fetch /, { exitCode: 128 }],
    ...gh,
  ] as [RegExp, never][])
  const r = await prDiff(host, PR, '/c', 10)
  if ('error' in r) throw new Error(r.error)
  expect(r.narrow).toBe(true)
  expect(r.base).toBe('base1')
  expect(r.diff.files.map(f => f.path)).toEqual(['a.ts'])
  const call = calls.find(c => c.line.startsWith('gh '))!
  expect(call.options?.timeoutMs).toBe(60_000)
  expect(call.options?.env).toBeUndefined()
})

test('an acme PR runs gh with the account config of its owner', async () => {
  const { host, calls } = fakeHost([LIGHTHOUSE_CONFIG, [/^gh pr diff 7 -R acme\/x$/, { stdout: GH }]])
  await prDiff(host, { ...PR, slug: 'acme/x' }, null, 3)
  expect(calls.find(c => c.line.startsWith('gh '))!.options?.env).toEqual(ACME_ACCOUNT)
})

test('no clone: gh pr diff straight away, no git command', async () => {
  const { host, calls } = fakeHost(gh)
  const r = await prDiff(host, PR, null, 3)
  expect('diff' in r && r.narrow).toBe(true)
  expect(calls.map(c => c.line).filter(line => !line.startsWith('cat '))).toEqual(['gh pr diff 7 -R a/b'])
})

test('a failing merge-base or clone diff: gh pr diff', async () => {
  for (const broken of [
    [/merge-base/, { exitCode: 1 }],
    [/ diff --no-color/, { exitCode: 128 }],
  ] as [RegExp, never][]) {
    const { host } = fakeHost([broken, ...present, ...gh])
    const r = await prDiff(host, PR, '/c', 3)
    expect('diff' in r && r.narrow).toBe(true)
  }
})

test('an empty diff from the clone: gh pr diff', async () => {
  const { host } = fakeHost([
    [/ diff --no-color/, { stdout: '' }],
    ...present,
    ...gh,
  ] as [RegExp, never][])
  const r = await prDiff(host, PR, '/c', 3)
  expect('diff' in r && r.narrow && r.diff.files.length === 1).toBe(true)
})

test('a git command that rejects counts as a failed step', async () => {
  const { host } = fakeHost([...gh])
  const rejecting = { ...host, run: async (argv: readonly string[], options?: object) => {
    if (argv[0] === 'git') throw new Error('spawn failed')
    return host.run(argv, options)
  } }
  const r = await prDiff(rejecting, PR, '/c', 3)
  expect('diff' in r && r.narrow).toBe(true)
})

test('gh pr diff failing or rejecting: a github failure', async () => {
  expect(await prDiff(fakeHost([[/^gh /, { exitCode: 1, stderr: 'no' }]]).host, PR, null, 3)).toEqual({ error: 'github' })
  const { host } = fakeHost([])
  const rejecting = { ...host, run: async () => { throw new Error('timeout') } }
  expect(await prDiff(rejecting, PR, '/c', 3)).toEqual({ error: 'github' })
})

test('a cut gh pr diff: a truncated failure', async () => {
  expect(await prDiff(fakeHost([[/^gh /, { stdout: GH, truncated: true }]]).host, PR, null, 3)).toEqual({ error: 'truncated' })
})
