import { expect, test } from 'claude-code/testing'
import type { DiffFile, Review } from '../../hooks/model'
import { parseReview } from '../../hooks/review/parse'

const hunkA = '@@ -1,2 +1,3 @@ function a()'
const hunkB = '@@ -20,1 +21,1 @@'
const files: DiffFile[] = [
  {
    path: 'src/a.ts',
    status: 'modified',
    binary: false,
    hunks: [
      { header: hunkA, newStart: 1, newLines: 3, text: `${hunkA}\n+added` },
      { header: hunkB, newStart: 21, newLines: 0, text: `${hunkB}\n-removed` },
    ],
  },
  { path: 'src/b.ts', status: 'added', binary: false, hunks: [{ header: '@@ -0,0 +1 @@', newStart: 1, newLines: 1, text: '@@ -0,0 +1 @@\n+b' }] },
  { path: 'src/c.ts', status: 'deleted', binary: false, hunks: [{ header: '@@ -1 +0,0 @@', newStart: 0, newLines: 0, text: '@@ -1 +0,0 @@\n-c' }] },
]
const meta = { repo: '/r', ref: 'main', diffHash: 'h1', skipped: ['dist/x.js'], now: Date.UTC(2026, 9, 17, 10, 0, 0) }

const intention = (id: number, extra: object = {}) => ({ id, title: `T${id}`, why: `W${id}`, origin: 'conversation', ...extra })
const change = (extra: object = {}) => ({ hunk: hunkA, lines: [1, 3], intention: 1, explanation: 'Ajoute a', ...extra })
const file = (path: string, extra: object = {}) => ({ path, role: 'Rôle', importance: 'key', status: 'modified', changes: [change()], ...extra })
const reply = (extra: object = {}) => ({ summary: 'Résumé', intentions: [intention(1)], files: [file('src/a.ts')], ...extra })
const parse = (value: unknown) => parseReview(typeof value === 'string' ? value : JSON.stringify(value), files, meta)
const ok = (value: unknown): Review => {
  const result = parse(value)
  if ('error' in result) throw new Error(result.error)
  return result
}

test('a valid reply becomes a full review, with the hunk text copied from the diff', () => {
  expect(ok(reply())).toEqual({
    source: { kind: 'conversation', repo: '/r', ref: 'main' },
    diffHash: 'h1',
    summary: 'Résumé',
    intentions: [{ id: 1, title: 'T1', why: 'W1', origin: 'conversation' }],
    files: [
      {
        path: 'src/a.ts',
        role: 'Rôle',
        importance: 'key',
        status: 'modified',
        changes: [{ hunk: hunkA, lines: [1, 3], intention: 1, explanation: 'Ajoute a', text: `${hunkA}\n+added` }],
      },
      // Left out by the reply: listed all the same.
      { path: 'src/b.ts', role: '', importance: 'normal', status: 'added', changes: [] },
      { path: 'src/c.ts', role: '', importance: 'normal', status: 'deleted', changes: [] },
    ],
    skipped: ['dist/x.js'],
    generatedAt: '2026-10-17T10:00:00.000Z',
  })
})

test('JSON in a json block surrounded by prose is accepted', () => {
  const text = `Voici la revue :\n\`\`\`json\n${JSON.stringify(reply())}\n\`\`\`\nBonne lecture.`
  expect(ok(text).summary).toBe('Résumé')
})

test('JSON wrapped in prose without a block is accepted', () => {
  expect(ok(`Voici : ${JSON.stringify(reply())} fin.`).summary).toBe('Résumé')
})

test('a reply cut in the middle of an array is an invalid JSON error', () => {
  const cut = JSON.stringify(reply({ files: [file('src/a.ts'), file('src/b.ts')] }))
  expect(parse(cut.slice(0, cut.indexOf('"src/b.ts"') + 3))).toEqual({ error: 'invalid JSON' })
  expect(parse('not json at all')).toEqual({ error: 'invalid JSON' })
})

test('a missing or empty summary, or files that is not an array, is refused', () => {
  const refused = { error: 'missing summary or files' }
  expect(parse(reply({ summary: '' }))).toEqual(refused)
  expect(parse(reply({ summary: 3 }))).toEqual(refused)
  expect(parse(reply({ files: {} }))).toEqual(refused)
  expect(parse('[]')).toEqual(refused)
})

test('only the first 5 valid intentions are kept', () => {
  const intentions = [1, 2, 3, 4, 5, 6, 7].map(id => intention(id))
  expect(ok(reply({ intentions })).intentions.map(i => i.id)).toEqual([1, 2, 3, 4, 5])
})

test('invalid intentions are dropped before the cap is applied', () => {
  const intentions = [{ id: 'x', title: 'T', why: 'W' }, intention(2, { why: 4 }), intention(3), intention(4.5)]
  expect(ok(reply({ intentions })).intentions.map(i => i.id)).toEqual([3])
})

test('an unknown origin becomes inferred', () => {
  expect(ok(reply({ intentions: [intention(1, { origin: 'sure' })] })).intentions[0].origin).toBe('inferred')
})

test('a file whose path is not in the diff is removed', () => {
  expect(ok(reply({ files: [file('src/invented.ts'), file('src/a.ts')] })).files.map(f => f.path)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
})

test('an unknown importance becomes normal and the status comes from the diff', () => {
  const result = ok(reply({ files: [file('src/b.ts', { importance: 'huge', status: 'deleted', changes: [] })] }))
  expect(result.files[0].importance).toBe('normal')
  expect(result.files[0].status).toBe('added')
})

test('a role that is not a string becomes empty', () => {
  expect(ok(reply({ files: [file('src/a.ts', { role: 5 })] })).files[0].role).toBe('')
})

test('a hunk that is not a header of the file is removed', () => {
  const changes = [change({ hunk: '@@ -99 +99 @@' }), change({ hunk: hunkB, intention: null, explanation: 'Retire' })]
  const result = ok(reply({ files: [file('src/a.ts', { changes })] }))
  expect(result.files[0].changes.map(c => c.hunk)).toEqual([hunkB])
  expect(result.files[0].changes[0].text).toBe(`${hunkB}\n-removed`)
})

test('a header with surrounding whitespace matches, a truncated one does not', () => {
  const changes = [change({ hunk: `  ${hunkA}\n` }), change({ hunk: '@@ -1,2 +1,3 @@' })]
  expect(ok(reply({ files: [file('src/a.ts', { changes })] })).files[0].changes).toHaveLength(1)
})

test('a minor file has no changes even when the model listed some', () => {
  expect(ok(reply({ files: [file('src/a.ts', { importance: 'minor' })] })).files[0].changes).toEqual([])
})

test('files are sorted key, normal, minor, keeping the reply order inside a group', () => {
  const sorted = [
    file('src/a.ts', { importance: 'minor' }),
    file('src/b.ts', { importance: 'normal' }),
    file('src/c.ts', { importance: 'key' }),
    file('src/a.ts', { importance: 'key' }),
  ]
  const result = ok(reply({ files: sorted }))
  expect(result.files.map(f => `${f.path}:${f.importance}`)).toEqual(['src/c.ts:key', 'src/a.ts:key', 'src/b.ts:normal', 'src/a.ts:minor'])
})

test('an intention that does not exist becomes null', () => {
  const result = ok(reply({ files: [file('src/a.ts', { changes: [change({ intention: 9 }), change({ intention: 'a' }), change({ intention: 1 })] })] }))
  expect(result.files[0].changes.map(c => c.intention)).toEqual([null, null, 1])
})

test('an intention beyond the 5 kept ones becomes null', () => {
  const intentions = [1, 2, 3, 4, 5, 6].map(id => intention(id))
  const result = ok(reply({ intentions, files: [file('src/a.ts', { changes: [change({ intention: 6 })] })] }))
  expect(result.files[0].changes[0].intention).toBeNull()
})

test('lines that are not two integers are derived from the matched hunk', () => {
  const changes = [
    change({ lines: 'oops' }),
    change({ lines: [1] }),
    change({ lines: [1.5, 2] }),
    change({ hunk: hunkB, lines: null }),
    change({ lines: [4, 6] }),
  ]
  const result = ok(reply({ files: [file('src/a.ts', { changes })] }))
  expect(result.files[0].changes.map(c => c.lines)).toEqual([[1, 3], [1, 3], [1, 3], [21, 21], [4, 6]])
})

test('a change whose explanation is not a string is dropped', () => {
  const changes = [change({ explanation: undefined }), change({ explanation: 7 }), change()]
  expect(ok(reply({ files: [file('src/a.ts', { changes })] })).files[0].changes).toHaveLength(1)
})

test('malformed entries in intentions, files and changes are ignored', () => {
  const result = ok(reply({ intentions: [null, 'x', intention(1)], files: [null, 'x', file('src/a.ts', { changes: [null, 4, change()] })] }))
  expect(result.intentions).toHaveLength(1)
  expect(result.files.map(f => f.role)).toEqual(['Rôle', '', '']) // b.ts and c.ts left out, listed all the same
  expect(result.files[0].changes).toHaveLength(1)
})

test('a diff file the model left out is listed as normal, without role or changes, before the minor files', () => {
  const result = ok(reply({ files: [file('src/c.ts', { importance: 'minor' }), file('src/a.ts')] }))
  expect(result.files.map(f => `${f.path}:${f.importance}`)).toEqual(['src/a.ts:key', 'src/b.ts:normal', 'src/c.ts:minor'])
  expect(result.files[1]).toEqual({ path: 'src/b.ts', role: '', importance: 'normal', status: 'added', changes: [] })
})

test('a skipped file the model left out stays out of the files', () => {
  const withLock: DiffFile[] = [...files, { path: 'yarn.lock', status: 'modified', binary: false, hunks: [] }]
  const result = parseReview(JSON.stringify(reply()), withLock, { ...meta, skipped: ['yarn.lock'] })
  expect('error' in result ? [] : result.files.map(f => f.path)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
})

test('inferredOnly turns every intention origin into inferred', () => {
  const result = parseReview(JSON.stringify(reply({ intentions: [intention(1), intention(2, { origin: 'inferred' })] })), files, { ...meta, kind: 'pr', inferredOnly: true })
  if ('error' in result) throw new Error(result.error)
  expect(result.intentions.map(item => item.origin)).toEqual(['inferred', 'inferred'])
})

test('without inferredOnly, a conversation origin stays', () => {
  expect(ok(reply()).intentions[0].origin).toBe('conversation')
  const result = parseReview(JSON.stringify(reply()), files, { ...meta, kind: 'conversation', inferredOnly: false })
  if ('error' in result) throw new Error(result.error)
  expect(result.intentions[0].origin).toBe('conversation')
})

test('kind pr gives a pr source, kind conversation a conversation source', () => {
  const asPr = parseReview(JSON.stringify(reply()), files, { ...meta, kind: 'pr', inferredOnly: false })
  if ('error' in asPr) throw new Error(asPr.error)
  expect(asPr.source.kind).toBe('pr')
  expect(ok(reply()).source.kind).toBe('conversation')
})
