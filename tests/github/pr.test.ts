import { expect, test } from 'claude-code/testing'
import { branchPr, prDetail, prInfo } from '../../hooks/github/pr'
import { ACME_ACCOUNT, LIGHTHOUSE_CONFIG } from '../helpers/accounts'
import { fakeHost } from '../helpers/fake-host'

const view = (state = 'OPEN', extra: object = {}) =>
  JSON.stringify({
    number: 7,
    title: 'Add x',
    state,
    url: 'https://github.com/acme/x/pull/7',
    headRefName: 'feat/x',
    headRefOid: 'h1',
    baseRefName: 'main',
    baseRefOid: 'b1',
    ...extra,
  })

test('prInfo reads a PR, lowercases its state and uses the account of the repo', async () => {
  const { host, calls } = fakeHost([LIGHTHOUSE_CONFIG, [/^gh pr view 7/, { stdout: view('MERGED') }]])
  expect(await prInfo(host, { slug: 'acme/x', number: 7 })).toEqual({
    slug: 'acme/x',
    number: 7,
    title: 'Add x',
    state: 'merged',
    url: 'https://github.com/acme/x/pull/7',
    headRefName: 'feat/x',
    headRefOid: 'h1',
    baseRefName: 'main',
    baseRefOid: 'b1',
  })
  const gh = calls.find(c => c.line.startsWith('gh '))!
  expect(gh.line).toContain('--json number,title,state,url,headRefName,headRefOid,baseRefName,baseRefOid')
  expect(gh.line).toContain('-R acme/x')
  expect(gh.options?.env).toEqual(ACME_ACCOUNT)
})

test('prInfo sends no account for a work repo', async () => {
  const { host, calls } = fakeHost([LIGHTHOUSE_CONFIG, [/^gh pr view/, { stdout: view() }]])
  expect((await prInfo(host, { slug: 'other/x', number: 7 }))?.state).toBe('open')
  expect(calls.find(c => c.line.startsWith('gh '))!.options?.env).toBeUndefined()
})

test('prInfo is null on a non-zero exit code', async () => {
  const { host } = fakeHost([[/^gh /, { exitCode: 1, stderr: 'no such PR' }]])
  expect(await prInfo(host, { slug: 'a/b', number: 7 })).toBeNull()
})

test('prInfo is null on unreadable JSON', async () => {
  const { host } = fakeHost([[/^gh /, { stdout: 'not json' }]])
  expect(await prInfo(host, { slug: 'a/b', number: 7 })).toBeNull()
})

test('prDetail adds the description and the commits, headline then body', async () => {
  const commits = [
    { messageHeadline: 'titre 1', messageBody: 'corps 1' },
    { messageHeadline: 'titre 2', messageBody: '' },
  ]
  const { host, calls } = fakeHost([[/^gh pr view/, { stdout: view('OPEN', { body: 'desc', commits }) }]])
  const detail = await prDetail(host, { slug: 'a/b', number: 7 })
  expect(detail?.body).toBe('desc')
  expect(detail?.commits).toEqual(['titre 1\n\ncorps 1', 'titre 2'])
  expect(detail?.state).toBe('open')
  expect(calls.find(c => c.line.startsWith('gh '))!.line).toContain(',body,commits')
})

test('prDetail is null on failure', async () => {
  const { host } = fakeHost([[/^gh /, { exitCode: 1 }]])
  expect(await prDetail(host, { slug: 'a/b', number: 7 })).toBeNull()
})

test('branchPr reads the PR of the folder branch from the folder', async () => {
  const { host, calls } = fakeHost([
    LIGHTHOUSE_CONFIG,
    [/remote get-url origin/, { stdout: 'https://github.com/acme/x.git' }],
    [/^gh pr view --json/, { stdout: view() }],
  ])
  const pr = await branchPr(host, '/work/x')
  expect(pr).toMatchObject({ slug: 'acme/x', number: 7, headRefName: 'feat/x' })
  const gh = calls.find(c => c.line.startsWith('gh '))
  expect(gh?.options?.cwd).toBe('/work/x')
  expect(gh?.options?.timeoutMs).toBe(30_000)
  expect(gh?.options?.env).toEqual(ACME_ACCOUNT)
})

test('branchPr is null without a GitHub origin, and never calls gh', async () => {
  const { host, calls } = fakeHost([[/remote get-url origin/, { exitCode: 2 }]])
  expect(await branchPr(host, '/work/x')).toBeNull()
  expect(calls.some(c => c.line.startsWith('gh '))).toBe(false)
})

test('branchPr is null when the branch has no PR', async () => {
  const { host } = fakeHost([
    [/remote get-url origin/, { stdout: 'git@github.com:a/b.git' }],
    [/^gh /, { exitCode: 1, stderr: 'no pull requests found' }],
  ])
  expect(await branchPr(host, '/work/x')).toBeNull()
})

// The real Host.run rejects when a command cannot start or runs past its timeout.
const rejecting = (only?: RegExp) => {
  const { host } = fakeHost([[/remote get-url origin/, { stdout: 'git@github.com:a/b.git' }]])
  const run = host.run
  host.run = async (argv, options) => {
    if (only === undefined || only.test(argv.join(' '))) throw new Error('cannot start')
    return run(argv, options)
  }
  return host
}

test('prInfo and prDetail are null when gh cannot start or times out', async () => {
  expect(await prInfo(rejecting(), { slug: 'a/b', number: 7 })).toBeNull()
  expect(await prDetail(rejecting(), { slug: 'a/b', number: 7 })).toBeNull()
})

test('branchPr is null when git cannot start or times out', async () => {
  expect(await branchPr(rejecting(/^git /), '/work/x')).toBeNull()
})

test('branchPr is null when gh cannot start or times out', async () => {
  expect(await branchPr(rejecting(/^gh /), '/work/x')).toBeNull()
})
