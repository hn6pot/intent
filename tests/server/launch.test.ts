import { expect, test } from 'claude-code/testing'
import { cleanOld, findPython, newToken, serverArgv, sessionDir, writeJson } from '../../hooks/server/launch'
import { fakeHost } from '../helpers/fake-host'

const TOKEN = '0123456789abcdef0123456789abcdef'
const PLUGIN = '/plugins/intent'

test('the session folder lives under the home, named after the session', () => {
  expect(sessionDir('/Users/me', 'abc-123')).toBe('/Users/me/.claude-mods/intent/abc-123')
})

test('the server command line: python, serve.py, folder, page, token, port', () => {
  expect(serverArgv('/usr/bin/python3', PLUGIN, '/s/abc', TOKEN, 4312)).toEqual([
    '/usr/bin/python3',
    '/plugins/intent/server/serve.py',
    '--dir',
    '/s/abc',
    '--page',
    '/plugins/intent/page',
    '--token',
    TOKEN,
    '--port',
    '4312',
  ])
})

test('a token is 32 lowercase hexadecimal characters', () => {
  const token = newToken(() => Math.random())
  expect(/^[0-9a-f]{32}$/.test(token)).toBe(true)
})

test('the token takes its digits from the injected random values', () => {
  expect(newToken(() => 0)).toBe('0'.repeat(32))
  expect(newToken(() => 0.999)).toBe('f'.repeat(32))
  expect(newToken(() => 0.5)).toBe('8'.repeat(32))
})

test('python: /usr/bin/python3 when it answers True', async () => {
  const { host, calls } = fakeHost([
    [/^\/usr\/bin\/python3 -c/, { stdout: 'True\n' }],
    [/^python3 -c/, { stdout: 'True\n' }],
  ])
  expect(await findPython(host)).toBe('/usr/bin/python3')
  expect(calls).toHaveLength(1)
  expect(calls[0]?.line).toBe('/usr/bin/python3 -c import sys; print(sys.version_info >= (3, 7))')
})

test('python: the PATH python3 when /usr/bin/python3 answers False', async () => {
  const { host } = fakeHost([
    [/^\/usr\/bin\/python3 -c/, { stdout: 'False\n' }],
    [/^python3 -c/, { stdout: 'True\n' }],
  ])
  expect(await findPython(host)).toBe('python3')
})

test('python: the PATH python3 when /usr/bin/python3 cannot run at all', async () => {
  const { host } = fakeHost([
    [/^\/usr\/bin\/python3 -c/, () => {
      throw new Error('ENOENT')
    }],
    [/^python3 -c/, { stdout: 'True\n' }],
  ])
  expect(await findPython(host)).toBe('python3')
})

test('python: null when no interpreter answers True', async () => {
  const { host } = fakeHost([
    [/^\/usr\/bin\/python3 -c/, { stdout: 'False\n' }],
    [/^python3 -c/, () => {
      throw new Error('ENOENT')
    }],
  ])
  expect(await findPython(host)).toBe(null)
})

test('writeJson writes a temporary file named after the clock, then moves it over the target', async () => {
  const { host, calls } = fakeHost([[/^mv -f /, { exitCode: 0 }]], 42)
  const written: [string, string][] = []
  await writeJson(host, async (path, text) => void written.push([path, text]), '/s/review.json', { a: 1 })
  expect(written).toEqual([['/s/review.json.tmp-42', '{"a":1}']])
  expect(calls.map(c => c.line)).toEqual(['mv -f /s/review.json.tmp-42 /s/review.json'])
})

test('writeJson: a failed move is an error naming the file', async () => {
  const { host } = fakeHost([[/^mv -f /, { exitCode: 1, stderr: 'Permission denied' }]], 1)
  let message = ''
  try {
    await writeJson(host, async () => {}, '/s/review.json', {})
  } catch (error) {
    message = String(error)
  }
  expect(message.includes('/s/review.json')).toBe(true)
})

test('cleanOld runs the find that removes session folders older than 30 days', async () => {
  const { host, calls } = fakeHost([[/^find /, { exitCode: 0 }]])
  await cleanOld(host, '/Users/me', 0)
  expect(calls.map(c => c.line)).toEqual([
    'find /Users/me/.claude-mods/intent -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +',
  ])
})

test('cleanOld ignores a failing find, such as a folder that does not exist yet', async () => {
  const { host } = fakeHost([[/^find /, { exitCode: 1, stderr: 'No such file or directory' }]])
  await cleanOld(host, '/Users/me', 0)
  const rejecting = fakeHost([[/^find /, () => {
    throw new Error('spawn failed')
  }]])
  await cleanOld(rejecting.host, '/Users/me', 0)
  expect(rejecting.calls).toHaveLength(1)
})
