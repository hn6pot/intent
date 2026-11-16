import { expect, test } from 'claude-code/testing'
import { prFile } from '../../hooks/github/pr-file'
import type { PrSource } from '../../hooks/model'
import { fakeHost } from '../helpers/fake-host'

const source = (clone: string | null): PrSource => ({ slug: 'a/b', number: 7, head: 'head1', clone, narrow: false })

test("a file of a PR is read from its clone at the reviewed head: `git show <head>:<path>`", async () => {
  const { host, calls } = fakeHost([[/ show head1:src\/a\.ts$/, { stdout: 'const a = 1\n' }]])
  expect(await prFile(host, source('/w/tree'), 'src/a.ts')).toBe('const a = 1\n')
  expect(calls.map(c => c.line)).toEqual(['git -C /w/tree show head1:src/a.ts'])
})

test('a PR without a clone, a file the head does not have, or a git that cannot start: rejects, the question goes without the file', async () => {
  const { host } = fakeHost([])
  await expect(prFile(host, source(null), 'a.ts')).rejects.toThrow()
  await expect(prFile(host, source('/w/tree'), 'gone.ts')).rejects.toThrow()
  const broken = { ...host, run: async () => { throw new Error('spawn') } }
  await expect(prFile(broken, source('/w/tree'), 'a.ts')).rejects.toThrow()
})
