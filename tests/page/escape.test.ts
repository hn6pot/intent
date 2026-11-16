import { expect, test } from 'claude-code/testing'
import { escapeHtml } from '../../page/escape.js'

test('escapeHtml escapes the five HTML characters', () => {
  expect(escapeHtml('<a&"b>')).toBe('&lt;a&amp;&quot;b&gt;')
  expect(escapeHtml("it's")).toBe('it&#39;s')
})
