import { expect, test } from 'claude-code/testing'
import { isPageError, launchKey, pageUrl } from '../../hooks/server/link'

const TOKEN = 'ab'.repeat(16)

test('the page address: 127.0.0.1, the port, the token', () => {
  expect(pageUrl(4312, TOKEN)).toBe(`http://127.0.0.1:4312/?t=${TOKEN}`)
})

test('a page kept from before a reload: its port and token again', () => {
  expect(launchKey({ url: pageUrl(4312, TOKEN), port: 4312, token: TOKEN }, () => 0)).toEqual({ port: 4312, token: TOKEN })
})

test('no page yet, or a failed one: any free port and a new token', () => {
  expect(launchKey(null, () => 0)).toEqual({ port: 0, token: '0'.repeat(32) })
  expect(launchKey({ error: 'start' }, () => 0.999)).toEqual({ port: 0, token: 'f'.repeat(32) })
})

test('only python missing and a server that did not start are errors', () => {
  expect(isPageError({ error: 'python' })).toBe(true)
  expect(isPageError({ error: 'start' })).toBe(true)
  expect(isPageError(null)).toBe(false)
  expect(isPageError({ url: pageUrl(1, TOKEN), port: 1, token: TOKEN })).toBe(false)
})
