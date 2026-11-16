import { expect, test } from 'claude-code/testing'
import { diffBase, nearestFolder, workTree } from '../../hooks/repos/base'
import { ACME_ACCOUNT, LIGHTHOUSE_CONFIG } from '../helpers/accounts'
import { fakeHost } from '../helpers/fake-host'

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const R = '/r'

type Canned = [RegExp, { exitCode?: number; stdout?: string }][]

/** A repo on `branch`, with an optional PR base and origin/HEAD, an origin URL, and a rebase marker. */
function repo(o: { branch: string; pr?: string; originHead?: string; origin?: string | null; rebase?: boolean }) {
  const canned: Canned = [
    [/rev-parse --abbrev-ref HEAD$/, { stdout: `${o.branch}\n` }],
    [/rev-parse --git-path rebase-merge$/, { stdout: '.git/rebase-merge\n' }],
    [/rev-parse --git-path rebase-apply$/, { stdout: '.git/rebase-apply\n' }],
    [/^test -d \/r\/\.git\/rebase-merge$/, { exitCode: o.rebase ? 0 : 1 }],
    [/^test -d \/r\/\.git\/rebase-apply$/, { exitCode: 1 }],
    [/remote get-url origin$/, o.origin == null ? { exitCode: 2 } : { stdout: `${o.origin}\n` }],
    [/^gh pr view/, o.pr ? { stdout: `${o.pr}\n` } : { exitCode: 1 }],
    [/symbolic-ref --short refs\/remotes\/origin\/HEAD$/, o.originHead ? { stdout: `origin/${o.originHead}\n` } : { exitCode: 128 }],
    [/merge-base HEAD origin\/(\w+)$/, { stdout: 'mergebase1\n' }],
    LIGHTHOUSE_CONFIG,
  ]
  return fakeHost(canned)
}

test('a feature branch with a PR: merge-base with the PR base, mode branch', async () => {
  const { host, calls } = repo({ branch: 'feat/x', pr: 'main', origin: 'git@github.com:other/y.git' })
  expect(await diffBase(host, R, { start: 'start1' })).toEqual({ base: 'mergebase1', mode: 'branch' })
  expect(calls.some(c => c.line === 'git -C /r merge-base HEAD origin/main')).toBe(true)
  const gh = calls.find(c => c.line.startsWith('gh pr view'))!
  expect(gh.options?.cwd).toBe(R)
  expect(gh.options?.env).toBeUndefined()
})

test('no PR: the base is origin/HEAD without its origin/ prefix', async () => {
  const { host, calls } = repo({ branch: 'feat/x', originHead: 'develop', origin: 'git@github.com:other/y.git' })
  expect(await diffBase(host, R, { start: null })).toEqual({ base: 'mergebase1', mode: 'branch' })
  expect(calls.some(c => c.line === 'git -C /r merge-base HEAD origin/develop')).toBe(true)
})

test('on the default branch: the remembered start, mode default', async () => {
  const { host, calls } = repo({ branch: 'main', pr: 'main', origin: 'x' })
  expect(await diffBase(host, R, { start: 'start1' })).toEqual({ base: 'start1', mode: 'default' })
  expect(calls.some(c => c.line.includes('merge-base'))).toBe(false)
})

test('on the default branch without a PR, known through origin/HEAD', async () => {
  const { host } = repo({ branch: 'main', originHead: 'main', origin: 'x' })
  expect(await diffBase(host, R, { start: 'start1' })).toEqual({ base: 'start1', mode: 'default' })
})

test('detached HEAD: default mode, no merge-base', async () => {
  const { host, calls } = repo({ branch: 'HEAD', pr: 'main', origin: 'x' })
  expect(await diffBase(host, R, { start: 'start1' })).toEqual({ base: 'start1', mode: 'default' })
  expect(calls.some(c => c.line.includes('merge-base'))).toBe(false)
})

test('rebase in progress: default mode, no merge-base', async () => {
  const { host, calls } = repo({ branch: 'feat/x', pr: 'main', origin: 'x', rebase: true })
  expect(await diffBase(host, R, { start: 'start1' })).toEqual({ base: 'start1', mode: 'default' })
  expect(calls.some(c => c.line.includes('merge-base'))).toBe(false)
})

test('an absolute --git-path (worktree) is used as is', async () => {
  const { host } = fakeHost([
    [/rev-parse --abbrev-ref HEAD$/, { stdout: 'feat/x\n' }],
    [/rev-parse --git-path rebase-merge$/, { stdout: '/main/.git/worktrees/w/rebase-merge\n' }],
    [/rev-parse --git-path rebase-apply$/, { stdout: '/main/.git/worktrees/w/rebase-apply\n' }],
    [/^test -d \/main\/\.git\/worktrees\/w\/rebase-merge$/, { exitCode: 0 }],
  ])
  expect(await diffBase(host, R, { start: 's' })).toEqual({ base: 's', mode: 'default' })
})

test('a repo without origin and without a start: the empty tree', async () => {
  const { host } = repo({ branch: 'main', origin: null })
  expect(await diffBase(host, R, { start: null })).toEqual({ base: EMPTY_TREE, mode: 'default' })
})

test('a repo without any commit: no branch name, the empty tree, no error', async () => {
  const { host } = fakeHost([[/rev-parse --abbrev-ref HEAD$/, { exitCode: 128, stderr: 'fatal: ambiguous argument HEAD' }]])
  expect(await diffBase(host, R, { start: null })).toEqual({ base: EMPTY_TREE, mode: 'default' })
})

test('a branch with a base but a failing merge-base: default mode', async () => {
  const { host } = fakeHost([
    [/rev-parse --abbrev-ref HEAD$/, { stdout: 'feat/x\n' }],
    [/rev-parse --git-path/, { stdout: '.git/nothing\n' }],
    [/^test -d/, { exitCode: 1 }],
    [/remote get-url/, { stdout: 'x\n' }],
    [/^gh pr view/, { stdout: 'main\n' }],
    [/merge-base/, { exitCode: 1 }],
  ])
  expect(await diffBase(host, R, { start: 'start1' })).toEqual({ base: 'start1', mode: 'default' })
})

test('an acme repo: gh runs with the account config of its owner, in the repo', async () => {
  const { host, calls } = repo({ branch: 'feat/x', pr: 'main', origin: 'git@github.com:acme/x.git' })
  await diffBase(host, R, { start: null })
  const gh = calls.find(c => c.line.startsWith('gh pr view'))!
  expect(gh.options?.env).toEqual(ACME_ACCOUNT)
  expect(gh.options?.cwd).toBe(R)
  expect(gh.line).toBe('gh pr view --json baseRefName -q .baseRefName')
})

test('workTree: the top level of the repo, null when the folder is gone or not a repo', async () => {
  const ok = fakeHost([[/^git -C \/r\/src rev-parse --show-toplevel$/, { stdout: '/r\n' }]])
  expect(await workTree(ok.host, '/r/src')).toBe('/r')
  const gone = fakeHost([[/rev-parse --show-toplevel/, { exitCode: 128, stderr: 'fatal: cannot change to' }]])
  expect(await workTree(gone.host, '/nope')).toBeNull()
})

test('gh that cannot start or times out (a rejection): same as no PR, the base is origin/HEAD', async () => {
  const { host } = fakeHost([
    [/rev-parse --abbrev-ref HEAD$/, { stdout: 'feat/x\n' }],
    [/rev-parse --git-path/, { stdout: '.git/nothing\n' }],
    [/^test -d/, { exitCode: 1 }],
    [/remote get-url/, { stdout: 'x\n' }],
    [/^gh pr view/, () => { throw new Error('spawn gh ENOENT') }],
    [/symbolic-ref/, { stdout: 'origin/develop\n' }],
    [/merge-base HEAD origin\/develop$/, { stdout: 'mb-develop\n' }],
  ])
  expect(await diffBase(host, R, { start: 's' })).toEqual({ base: 'mb-develop', mode: 'branch' })
})

test('the PR base is kept per folder and branch once gh answered; no PR or a rejection is asked again', async () => {
  let answer: () => { exitCode?: number; stdout?: string } = () => ({ stdout: 'main\n' })
  let branch = 'feat/x'
  const { host, calls } = fakeHost([
    [/rev-parse --abbrev-ref HEAD$/, () => ({ stdout: `${branch}\n` })],
    [/rev-parse --git-path/, { stdout: '.git/nothing\n' }],
    [/^test -d/, { exitCode: 1 }],
    [/remote get-url/, { stdout: 'x\n' }],
    [/^gh pr view/, () => answer()],
    [/symbolic-ref/, { stdout: 'origin/main\n' }],
    [/merge-base/, { stdout: 'mb\n' }],
  ])
  const ghCalls = () => calls.filter(c => c.line.startsWith('gh ')).length
  const known = new Map<string, string>()
  await diffBase(host, R, { start: null }, known)
  await diffBase(host, R, { start: null }, known)
  expect(ghCalls()).toBe(1) // kept

  branch = 'feat/y'
  answer = () => ({ exitCode: 1 })
  await diffBase(host, R, { start: null }, known)
  await diffBase(host, R, { start: null }, known)
  expect(ghCalls()).toBe(3) // another branch, and no PR yet: asked each time

  branch = 'feat/z'
  answer = () => { throw new Error('timed out') }
  await diffBase(host, R, { start: null }, known)
  answer = () => ({ stdout: 'develop\n' })
  await diffBase(host, R, { start: null }, known)
  expect(ghCalls()).toBe(5) // a rejection is asked again
  expect(known.get(`${R}\0feat/z`)).toBe('develop')
})

test('nearestFolder: the folder itself when it exists, else its nearest existing parent', async () => {
  const { host } = fakeHost([
    [/^test -d \/r\/new\/deep$/, { exitCode: 1 }],
    [/^test -d \/r\/new$/, { exitCode: 1 }],
    [/^test -d \/r$/, { exitCode: 0 }],
  ])
  expect(await nearestFolder(host, '/r/new/deep')).toBe('/r')
  expect(await nearestFolder(host, '/r')).toBe('/r')
  expect(await nearestFolder(fakeHost([]).host, '/a/b')).toBe('/')
})
