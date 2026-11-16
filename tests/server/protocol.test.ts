import { expect, test } from 'claude-code/testing'
import { lineReader } from '../../hooks/server/protocol'

const READY = '{"type":"ready","port":4312}'
const VIEWER = '{"type":"viewer"}'
const PUBLISH = '{"type":"publish","root":"/repo"}'
const FREE_ASK = '{"type":"ask","kind":"free","root":"/repo","path":null,"hunk":null,"text":"pourquoi ?"}'

test('a whole line gives its event', () => {
  expect(lineReader()(READY + '\n')).toEqual([{ type: 'ready', port: 4312 }])
})

test('a line cut in two chunks is read once its end arrives', () => {
  const read = lineReader()
  expect(read(READY.slice(0, 10))).toEqual([])
  expect(read(READY.slice(10) + '\n')).toEqual([{ type: 'ready', port: 4312 }])
})

test('several lines in one chunk, in order', () => {
  expect(lineReader()(READY + '\n' + PUBLISH + '\n' + VIEWER + '\n')).toEqual([
    { type: 'ready', port: 4312 },
    { type: 'publish', root: '/repo' },
    { type: 'viewer' },
  ])
})

test('a line that is not JSON is skipped, the others are read', () => {
  expect(lineReader()(READY + '\nnot json\n' + VIEWER + '\n')).toEqual([{ type: 'ready', port: 4312 }, { type: 'viewer' }])
})

test('an ask without a root is ignored', () => {
  expect(lineReader()('{"type":"ask","kind":"free","text":"pourquoi ?"}\n')).toEqual([])
})

test('CRLF line endings are accepted', () => {
  expect(lineReader()(READY + '\r\n' + VIEWER + '\r\n')).toEqual([{ type: 'ready', port: 4312 }, { type: 'viewer' }])
})

test('a free ask keeps its text; the nulls the server writes for absent fields are dropped', () => {
  expect(lineReader()(FREE_ASK + '\n')).toEqual([{ type: 'ask', kind: 'free', root: '/repo', text: 'pourquoi ?' }])
})

test('a here ask needs a path and a hunk', () => {
  const read = lineReader()
  expect(read('{"type":"ask","kind":"here","root":"/repo","path":"a.ts","hunk":"h1"}\n'))
    .toEqual([{ type: 'ask', kind: 'here', root: '/repo', path: 'a.ts', hunk: 'h1' }])
  expect(read('{"type":"ask","kind":"here","root":"/repo","path":"a.ts"}\n')).toEqual([])
})

test('a free ask without text is ignored, and so is an unknown kind', () => {
  const read = lineReader()
  expect(read('{"type":"ask","kind":"free","root":"/repo"}\n')).toEqual([])
  expect(read('{"type":"ask","kind":"other","root":"/repo","text":"x"}\n')).toEqual([])
})

test('an optional field that is not a string spoils the ask', () => {
  expect(lineReader()('{"type":"ask","kind":"free","root":"/repo","text":"x","hunk":3}\n')).toEqual([])
})

test('the port is a positive integer', () => {
  const read = lineReader()
  expect(read('{"type":"ready","port":0}\n')).toEqual([])
  expect(read('{"type":"ready","port":-1}\n')).toEqual([])
  expect(read('{"type":"ready","port":4.5}\n')).toEqual([])
  expect(read('{"type":"ready","port":"4312"}\n')).toEqual([])
})

test('publish and refresh need a non-empty root', () => {
  const read = lineReader()
  expect(read('{"type":"publish","root":""}\n')).toEqual([])
  expect(read('{"type":"refresh"}\n')).toEqual([])
  expect(read('{"type":"refresh","root":"/repo"}\n')).toEqual([{ type: 'refresh', root: '/repo' }])
})

test('unknown types, non-object lines and blank lines are ignored', () => {
  expect(lineReader()('{"type":"nope"}\n[1,2]\nnull\n\n   \n')).toEqual([])
})

test('a selection ask carries its file, its lines and their text', () => {
  const line = { type: 'ask', kind: 'selection', root: '/repo', path: 'a.ts', from: 3, to: 5, text: 'const a = 1', hunk: null }
  expect(lineReader()(JSON.stringify(line) + '\n'))
    .toEqual([{ type: 'ask', kind: 'selection', root: '/repo', path: 'a.ts', from: 3, to: 5, text: 'const a = 1' }])
})

test('a selection ask with bad lines, no path or a text past 4 000 characters is ignored', () => {
  const read = lineReader()
  const good = { type: 'ask', kind: 'selection', root: '/repo', path: 'a.ts', from: 3, to: 5, text: 'x' }
  for (const bad of [
    { from: 6 }, { from: 0, to: 0 }, { from: 2.5 }, { from: '3' }, { to: null }, { path: '' }, { path: undefined },
    { text: 'x'.repeat(4001) }, { text: 7 },
  ]) expect(read(JSON.stringify({ ...good, ...bad }) + '\n')).toEqual([])
  expect(read(JSON.stringify({ ...good, from: 5, text: 'x'.repeat(4000) }) + '\n')).toHaveLength(1)
})
