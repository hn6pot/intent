import { expect, test } from 'claude-code/testing'
import type { DiffFile } from '../../hooks/model'
import { fitDiff, isSkipped } from '../../hooks/review/skip'

const file = (path: string, size = 10, binary = false): DiffFile => ({
  path,
  status: 'modified',
  binary,
  hunks: [{ header: '@@ -1 +1 @@', newStart: 1, newLines: 1, text: 'x'.repeat(size) }],
})

test('generated files, lock files and binary files are skipped', () => {
  for (const path of ['pnpm-lock.yaml', 'a/package-lock.json', 'Cargo.lock', 'dist/x.js', 'web/build/y.css']) {
    expect(isSkipped(file(path))).toBe(true)
  }
  expect(isSkipped(file('img/logo.png', 10, true))).toBe(true)
})

test('a file named like a build folder, or a .md file, is kept', () => {
  expect(isSkipped(file('src/build.ts'))).toBe(false)
  expect(isSkipped(file('docs/distance.md'))).toBe(false)
})

test('fitDiff moves skipped files to skipped and keeps the others in order', () => {
  const files = [file('dist/x.js'), file('src/a.ts'), file('yarn.lock'), file('src/b.ts')]
  const result = fitDiff(files)
  expect(result.skipped).toEqual(['dist/x.js', 'yarn.lock'])
  expect(result.full.map(f => f.path)).toEqual(['src/a.ts', 'src/b.ts'])
  expect(result.headersOnly).toEqual([])
})

test('fitDiff sends the biggest files as headers only until the total fits the cap', () => {
  const files = [file('a.ts', 30_000), file('b.ts', 25_000), file('c.ts', 10_000)]
  const result = fitDiff(files, 60_000)
  expect(result.headersOnly.map(f => f.path)).toEqual(['a.ts'])
  expect(result.full.map(f => f.path)).toEqual(['b.ts', 'c.ts'])
  expect(result.skipped).toEqual([])
})

test('the size of a file is the sum of its hunks', () => {
  const twoHunks: DiffFile = {
    path: 'big.ts',
    status: 'modified',
    binary: false,
    hunks: [
      { header: '@@ -1 +1 @@', newStart: 1, newLines: 1, text: 'x'.repeat(40_000) },
      { header: '@@ -9 +9 @@', newStart: 9, newLines: 1, text: 'x'.repeat(40_000) },
    ],
  }
  const result = fitDiff([twoHunks, file('small.ts', 100)])
  expect(result.headersOnly.map(f => f.path)).toEqual(['big.ts'])
  expect(result.full.map(f => f.path)).toEqual(['small.ts'])
})
