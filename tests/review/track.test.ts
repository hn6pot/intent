import { expect, test } from 'claude-code/testing'
import { hashText } from '../../hooks/repos/diff'
import { type Tracking, track } from '../../hooks/review/track'
import { fakeHost } from '../helpers/fake-host'

const DIFF = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-x\n+y\n'

/** A repo at /r on its default branch, with one uncommitted change; `diff` code 128 when `diffFails`. */
const repo = (o: { diffFails?: boolean } = {}) =>
  fakeHost([
    [/^test -d \/r(\/src)?$/, { exitCode: 0 }],
    [/^test -d /, { exitCode: 1 }],
    [/-C \/r(\/src)? rev-parse --show-toplevel$/, { stdout: '/r\n' }],
    [/rev-parse --abbrev-ref HEAD$/, { stdout: 'main\n' }],
    [/rev-parse --git-path/, { stdout: '.git/nothing\n' }],
    [/rev-parse HEAD$/, { stdout: 'h0\n' }],
    [/ls-files/, { stdout: 'old.txt\0' }],
    [/ diff --no-color --no-ext-diff/, o.diffFails ? { exitCode: 128 } : { stdout: DIFF }],
  ])
const empty = (): Tracking => ({ slots: [], roots: new Map(), prBases: new Map() })

test('a folder only read: a dormant slot holding the diff hash of this first touch', async () => {
  const known = empty()
  expect(await track(repo().host, known, '/r/src', true)).toEqual({ root: '/r', changed: true })
  expect(known.slots).toHaveLength(1)
  expect(known.slots[0]).toMatchObject({ root: '/r', start: 'h0', preexisting: ['old.txt'], dormant: hashText(DIFF) })
  expect(known.roots.get('/r/src')).toBe('/r')
})

test('a folder written: an awake slot, without computing any diff', async () => {
  const known = empty()
  const { host, calls } = repo()
  expect(await track(host, known, '/r/src', false)).toEqual({ root: '/r', changed: true })
  expect(known.slots[0]!.dormant).toBeNull()
  expect(calls.some(c => c.line.includes(' diff '))).toBe(false)
})

test('a write wakes a dormant slot; another read changes nothing', async () => {
  const known = empty()
  const { host } = repo()
  await track(host, known, '/r', true)
  expect(await track(host, known, '/r', true)).toEqual({ root: '/r', changed: false })
  expect(known.slots[0]!.dormant).not.toBeNull()
  expect(await track(host, known, '/r/src', false)).toEqual({ root: '/r', changed: true })
  expect(known.slots[0]!.dormant).toBeNull()
  expect(await track(host, known, '/r', true)).toEqual({ root: '/r', changed: false })
  expect(known.slots[0]!.dormant).toBeNull()
})

test('a git failure while reading the first hash: dormant with an empty hash, so the first diff that reads wakes it', async () => {
  const known = empty()
  await track(repo({ diffFails: true }).host, known, '/r', true)
  expect(known.slots[0]!.dormant).toBe('')
})

test('a folder outside any repo: null, no slot', async () => {
  const known = empty()
  expect(await track(fakeHost([[/^test -d/, { exitCode: 0 }]]).host, known, '/tmp/x', false)).toBeNull()
  expect(known.slots).toEqual([])
})
