import { expect, test } from 'claude-code/testing'
import { ghEnv, ghJson, originSlug, slugFromUrl } from '../../hooks/github/gh'
import { ACME_ACCOUNT, LIGHTHOUSE_CONFIG } from '../helpers/accounts'
import { fakeHost } from '../helpers/fake-host'

test("ghEnv picks the gh account of the repo's owner from the lighthouse config", async () => {
  const { host } = fakeHost([LIGHTHOUSE_CONFIG])
  expect(await ghEnv(host, 'acme/x')).toEqual(ACME_ACCOUNT)
  expect(await ghEnv(host, 'other/x')).toBeUndefined()
})

test('ghEnv keeps an absolute folder as it is', async () => {
  const { host } = fakeHost([[/^cat /, { stdout: '{"ghConfigDirs":{"acme":"/opt/gh-acme"}}' }]])
  expect(await ghEnv(host, 'acme/x')).toEqual({ GH_CONFIG_DIR: '/opt/gh-acme' })
})

test('ghEnv uses the active account without a config, with a bad one, or with a bad entry', async () => {
  expect(await ghEnv(fakeHost([]).host, 'acme/x')).toBeUndefined()
  expect(await ghEnv(fakeHost([[/^cat /, { stdout: 'not json' }]]).host, 'acme/x')).toBeUndefined()
  expect(await ghEnv(fakeHost([[/^cat /, { stdout: '{"ghConfigDirs":{"acme":3}}' }]]).host, 'acme/x')).toBeUndefined()
})

test('ghJson passes the repo, the account and a 30 s timeout, and parses the JSON', async () => {
  const { host, calls } = fakeHost([LIGHTHOUSE_CONFIG, [/^gh pr view/, { stdout: '{"a":1}' }]])
  expect(await ghJson<{ a: number }>(host, 'acme/x', ['pr', 'view', '3'])).toEqual({ a: 1 })
  const gh = calls.find(c => c.line.startsWith('gh '))!
  expect(gh.line).toBe('gh pr view 3 -R acme/x')
  expect(gh.options?.env).toEqual(ACME_ACCOUNT)
  expect(gh.options?.timeoutMs).toBe(30_000)
})

test('ghJson leaves the account alone for an owner without one', async () => {
  const { host, calls } = fakeHost([LIGHTHOUSE_CONFIG, [/^gh /, { stdout: '{}' }]])
  await ghJson(host, 'other/x', ['pr', 'view', '3'])
  expect(calls.find(c => c.line.startsWith('gh '))!.options?.env).toBeUndefined()
})

test('ghJson rejects on a non-zero exit code', async () => {
  const { host } = fakeHost([[/^gh /, { exitCode: 1, stderr: 'not found' }]])
  await expect(ghJson(host, 'a/b', ['pr', 'view', '3'])).rejects.toThrow('not found')
})

test('slugFromUrl reads https and ssh GitHub URLs', () => {
  expect(slugFromUrl('https://github.com/a/b.git')).toBe('a/b')
  expect(slugFromUrl('git@github.com:a/b.git')).toBe('a/b')
  expect(slugFromUrl('https://gitlab.com/a/b.git')).toBeNull()
})

test('originSlug reads the origin of a folder', async () => {
  const { host } = fakeHost([[/remote get-url origin/, { stdout: 'git@github.com:acme/x.git\n' }]])
  expect(await originSlug(host, '/r')).toBe('acme/x')
})

test('originSlug is null without an origin or with a non-GitHub one', async () => {
  expect(await originSlug(fakeHost([[/remote get-url/, { exitCode: 2 }]]).host, '/r')).toBeNull()
  expect(await originSlug(fakeHost([[/remote get-url/, { stdout: 'https://gitlab.com/a/b' }]]).host, '/r')).toBeNull()
})

test('originSlug is null when git cannot start or times out', async () => {
  const { host } = fakeHost([])
  host.run = async () => {
    throw new Error('spawn failed')
  }
  expect(await originSlug(host, '/r')).toBeNull()
})
