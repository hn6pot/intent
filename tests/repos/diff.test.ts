import { expect, test } from 'claude-code/testing'
import { computeDiff, firstChange, hashText, rangeDiff } from '../../hooks/repos/diff'
import { fakeHost } from '../helpers/fake-host'

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

const TRACKED = `diff --git a/a.ts b/a.ts
index 1..2 100644
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-x
+y
`
const UNTRACKED = `diff --git a/new.ts b/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/new.ts
@@ -0,0 +1 @@
+hello
`

const answers = (tracked = TRACKED) =>
  [
    [/^git -c core\.quotepath=off -C \/r diff --no-color --no-ext-diff --find-renames -U3 --src-prefix=a\/ --dst-prefix=b\/ base1$/, { stdout: tracked }],
    [/^git -c core\.quotepath=off -C \/r ls-files -z --others --exclude-standard$/, { stdout: 'old.ts\0new.ts\0' }],
    [/^git -c core\.quotepath=off -C \/r diff --no-color --no-index --src-prefix=a\/ --dst-prefix=b\/ -- \/dev\/null new\.ts$/, { exitCode: 1, stdout: UNTRACKED }],
  ] as [RegExp, never][]

test('an untracked file already there at the start is not in the diff, a new one is', async () => {
  const { host, calls } = fakeHost(answers())
  const diff = await computeDiff(host, '/r', 'base1', ['old.ts'])
  expect(diff!.files.map(f => [f.path, f.status])).toEqual([['a.ts', 'modified'], ['new.ts', 'added']])
  expect(calls.some(c => c.line.includes('/dev/null old.ts'))).toBe(false)
})

test('git diff --no-index exits 1 when files differ: that is success', async () => {
  const { host } = fakeHost(answers())
  expect('files' in (await computeDiff(host, '/r', 'base1', ['old.ts']))).toBe(true)
})

test('the same text gives the same hash, and chars is the length of the whole text', async () => {
  const a = await computeDiff(fakeHost(answers()).host, '/r', 'base1', ['old.ts'])
  const b = await computeDiff(fakeHost(answers()).host, '/r', 'base1', ['old.ts'])
  expect(a!.hash).toBe(b!.hash)
  expect(a!.chars).toBe((TRACKED + UNTRACKED).length)
  const c = await computeDiff(fakeHost(answers(TRACKED.replace('+y', '+z'))).host, '/r', 'base1', ['old.ts'])
  expect(c!.hash).not.toBe(a!.hash)
})

test('a failing git diff: a git failure (whether the folder is gone is decided elsewhere)', async () => {
  const { host } = fakeHost([[/diff/, { exitCode: 128, stderr: 'fatal: cannot change to /r' }]])
  expect(await computeDiff(host, '/r', 'base1', [])).toEqual({ error: 'git' })
})

test('a failing ls-files: a git failure', async () => {
  const { host } = fakeHost([
    [/ diff --no-color --no-ext-diff/, { stdout: '' }],
    [/ls-files/, { exitCode: 128 }],
  ])
  expect(await computeDiff(host, '/r', 'base1', [])).toEqual({ error: 'git' })
})

test('a cut main diff (over 4 MiB): a truncated failure, never a partial review', async () => {
  const { host } = fakeHost([[/ diff --no-color --no-ext-diff/, { stdout: TRACKED, truncated: true }]])
  expect(await computeDiff(host, '/r', 'base1', [])).toEqual({ error: 'truncated' })
})

test('a new file whose --no-index fails (code 2 or more) is skipped, the rest of the diff stays', async () => {
  const { host } = fakeHost([
    [/ diff --no-color --no-ext-diff/, { stdout: TRACKED }],
    [/ls-files/, { stdout: 'bad.ts\0new.ts\0' }],
    [/--no-index .* bad\.ts$/, { exitCode: 2 }],
    [/--no-index .* new\.ts$/, { exitCode: 1, stdout: UNTRACKED }],
  ])
  const diff = await computeDiff(host, '/r', 'base1', [])
  if ('error' in diff) throw new Error(diff.error)
  expect(diff.files.map(f => f.path)).toEqual(['a.ts', 'new.ts'])
  expect(diff.skipped).toEqual(['bad.ts'])
})

test('60 new files: the first 50 are diffed one at a time, the other 10 skipped', async () => {
  const names = Array.from({ length: 60 }, (_, i) => `n${i}.ts`)
  const { host, calls } = fakeHost([
    [/ diff --no-color --no-ext-diff/, { stdout: '' }],
    [/ls-files/, { stdout: names.join('\0') + '\0' }],
    [/--no-index/, argv => ({ exitCode: 1, stdout: `diff --git a/${argv[argv.length - 1]} b/${argv[argv.length - 1]}\nnew file mode 100644\n` })],
  ])
  let running = 0
  let most = 0
  const counted = { ...host, run: async (argv: readonly string[], options?: object) => {
    running++
    most = Math.max(most, running)
    await new Promise(resolve => setTimeout(resolve, 0))
    running--
    return host.run(argv, options)
  } }
  const diff = await computeDiff(counted, '/r', 'base1', [])
  if ('error' in diff) throw new Error(diff.error)
  expect(calls.filter(c => c.line.includes('--no-index'))).toHaveLength(50)
  expect(diff.files).toHaveLength(50)
  expect(diff.skipped).toEqual(names.slice(50))
  expect(most).toBe(1)
})

test('the skipped new files count in the hash: one more past the cap is a change', async () => {
  const run = (count: number) => computeDiff(fakeHost([
    [/ diff --no-color --no-ext-diff/, { stdout: '' }],
    [/ls-files/, { stdout: Array.from({ length: count }, (_, i) => `n${i}.ts\0`).join('') }],
    [/--no-index/, argv => ({ exitCode: 1, stdout: `diff --git a/${argv[argv.length - 1]} b/${argv[argv.length - 1]}\n` })],
  ]).host, '/r', 'base1', [])
  const a = await run(51)
  const b = await run(52)
  expect('hash' in a && 'hash' in b && a.hash !== b.hash).toBe(true)
})

test('hashText: FNV-1a 32 bits in hexadecimal', () => {
  expect(hashText('')).toBe('811c9dc5')
  expect(hashText('a')).toBe('e40c292c')
  expect(hashText('foobar')).toBe('bf9cf968')
})

test('firstChange: HEAD and the untracked files present', async () => {
  const { host } = fakeHost([
    [/^git -C \/r rev-parse HEAD$/, { stdout: 'abc123\n' }],
    [/ls-files -z --others/, { stdout: 'a.ts\0b.ts\0' }],
  ])
  expect(await firstChange(host, '/r')).toEqual({ start: 'abc123', preexisting: ['a.ts', 'b.ts'] })
})

test('firstChange without HEAD (no commit yet): the empty tree', async () => {
  const { host } = fakeHost([
    [/rev-parse HEAD/, { exitCode: 128, stderr: 'fatal: ambiguous argument HEAD' }],
    [/ls-files -z --others/, { stdout: '' }],
  ])
  expect(await firstChange(host, '/r')).toEqual({ start: EMPTY_TREE, preexisting: [] })
})

test('non-ASCII untracked names come from ls-files -z and reach git diff unquoted', async () => {
  const { host, calls } = fakeHost([
    [/ diff --no-color --no-ext-diff/, { stdout: '' }],
    [/ls-files -z/, { stdout: 'été.md\0dir/café 2.txt\0' }],
    [/--no-index/, { exitCode: 1, stdout: 'diff --git a/été.md b/été.md\nnew file mode 100644\n--- /dev/null\n+++ b/été.md\n@@ -0,0 +1 @@\n+x\n' }],
  ])
  const diff = await computeDiff(host, '/r', 'base1', [])
  expect(diff!.files[0].path).toBe('été.md')
  expect(calls.map(c => c.line)).toContain('git -c core.quotepath=off -C /r diff --no-color --no-index --src-prefix=a/ --dst-prefix=b/ -- /dev/null dir/café 2.txt')
})

test('a wider context goes to -U<context> of the main diff and of every --no-index diff', async () => {
  const { host, calls } = fakeHost([
    [/ diff --no-color --no-ext-diff/, { stdout: TRACKED }],
    [/ls-files/, { stdout: 'new.ts\0' }],
    [/--no-index/, { exitCode: 1, stdout: UNTRACKED }],
  ])
  await computeDiff(host, '/r', 'base1', [], 10)
  const lines = calls.map(c => c.line)
  expect(lines).toContain('git -c core.quotepath=off -C /r diff --no-color --no-ext-diff --find-renames -U10 --src-prefix=a/ --dst-prefix=b/ base1')
  expect(lines).toContain('git -c core.quotepath=off -C /r diff --no-color --no-index -U10 --src-prefix=a/ --dst-prefix=b/ -- /dev/null new.ts')
})

test('rangeDiff passes <from> <to> and the context, and lists no untracked file', async () => {
  const { host, calls } = fakeHost([[/ diff --no-color --no-ext-diff/, { stdout: TRACKED }]])
  const diff = await rangeDiff(host, '/r', 'base1', 'head1', 10)
  if ('error' in diff) throw new Error(diff.error)
  expect(calls.map(c => c.line)).toEqual(['git -c core.quotepath=off -C /r diff --no-color --no-ext-diff --find-renames -U10 --src-prefix=a/ --dst-prefix=b/ base1 head1'])
  expect(diff.files.map(f => f.path)).toEqual(['a.ts'])
  expect(diff.skipped).toEqual([])
  expect(diff.chars).toBe(TRACKED.length)
})

test('rangeDiff has the hash of computeDiff for the same text, a git failure and a cut diff are failures', async () => {
  const range = await rangeDiff(fakeHost([[/ diff /, { stdout: TRACKED }]]).host, '/r', 'a', 'b')
  const worktree = await computeDiff(fakeHost([[/ diff /, { stdout: TRACKED }], [/ls-files/, { stdout: '' }]]).host, '/r', 'a', [])
  expect(range).toEqual(worktree)
  expect(await rangeDiff(fakeHost([[/ diff /, { exitCode: 128 }]]).host, '/r', 'a', 'b')).toEqual({ error: 'git' })
  expect(await rangeDiff(fakeHost([[/ diff /, { stdout: TRACKED, truncated: true }]]).host, '/r', 'a', 'b')).toEqual({ error: 'truncated' })
})
