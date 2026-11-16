import { expect, test } from 'claude-code/testing'
import { conversationPrs, prLinks, type ConversationMessage } from '../../hooks/github/links'

const PR5 = 'https://github.com/acme/api/pull/5'

const user = (text: string): ConversationMessage => ({ role: 'user', text, toolUses: [] })
// The real shape: the outcome sits on the call (`text`); a result, if any, comes in a following user message.
const bash = (command: string, text?: string, id = 'call-1'): ConversationMessage => ({
  role: 'assistant',
  text: '',
  toolUses: [{ tool: 'Bash', input: { command }, text, tool_use_id: id }],
})
const resultOf = (id: string, text: string): ConversationMessage => ({
  role: 'user',
  text: '',
  toolUses: [],
  toolResults: [{ tool_use_id: id, text }],
})

test('prLinks finds a PR link and its slug and number', () => {
  expect(prLinks(`see ${PR5} please`)).toEqual([{ slug: 'acme/api', number: 5 }])
})

test('prLinks reads the number before a trailing path', () => {
  expect(prLinks('https://github.com/a/b/pull/12/files')).toEqual([{ slug: 'a/b', number: 12 }])
})

test('prLinks keeps one entry per PR, in order of appearance', () => {
  const text = 'github.com/a/b/pull/2 github.com/a/b/pull/1 github.com/a/b/pull/2'
  expect(prLinks(text)).toEqual([
    { slug: 'a/b', number: 2 },
    { slug: 'a/b', number: 1 },
  ])
})

test('prLinks ignores other hosts', () => {
  expect(prLinks('https://gitlab.com/a/b/pull/3')).toEqual([])
})

test('a link in a user message is a viewed PR', () => {
  expect(conversationPrs([user(`look at ${PR5}`)])).toEqual([{ ref: { slug: 'acme/api', number: 5 }, opened: false }])
})

test('a link seen in a message, then output by gh pr create, is one opened entry', () => {
  const found = conversationPrs([user(PR5), bash('GH_CONFIG_DIR=x gh pr create --fill', PR5)])
  expect(found).toEqual([{ ref: { slug: 'acme/api', number: 5 }, opened: true }])
})

test('a link output by gh pr view is not an opened PR', () => {
  expect(conversationPrs([bash('gh pr view 5 --json url', PR5)])).toEqual([{ ref: { slug: 'acme/api', number: 5 }, opened: false }])
})

test('a gh pr create call whose own text holds the link is opened', () => {
  expect(conversationPrs([bash('gh pr create --fill', PR5)])).toEqual([{ ref: { slug: 'acme/api', number: 5 }, opened: true }])
})

test('the result of a gh pr create call, in the next user message, is opened', () => {
  const found = conversationPrs([bash('gh pr create --fill', undefined, 'c9'), resultOf('c9', PR5)])
  expect(found).toEqual([{ ref: { slug: 'acme/api', number: 5 }, opened: true }])
})

test('the result of another call is not opened, even next to a gh pr create', () => {
  const found = conversationPrs([bash('gh pr create --fill', undefined, 'c1'), bash('gh pr view 6', undefined, 'c2'), resultOf('c2', 'github.com/a/b/pull/6')])
  expect(found).toEqual([{ ref: { slug: 'a/b', number: 6 }, opened: false }])
})

test('in one message, only the gh pr create call opens its PR', () => {
  const message: ConversationMessage = {
    role: 'assistant',
    text: '',
    toolUses: [
      { tool: 'Bash', input: { command: 'gh pr create --fill' }, text: PR5, tool_use_id: 'c1' },
      { tool: 'Bash', input: { command: 'gh pr view 6' }, text: 'github.com/a/b/pull/6', tool_use_id: 'c2' },
    ],
  }
  expect(conversationPrs([message])).toEqual([
    { ref: { slug: 'acme/api', number: 5 }, opened: true },
    { ref: { slug: 'a/b', number: 6 }, opened: false },
  ])
})

test('a message without toolResults does not fail', () => {
  expect(conversationPrs([{ role: 'assistant', text: 'no link', toolUses: [] }])).toEqual([])
})

const readOf = (text: string, id = 'r1'): ConversationMessage => ({
  role: 'assistant',
  text: '',
  toolUses: [{ tool: 'Read', input: { file_path: '/w/notes.md' }, text, tool_use_id: id }],
})

test('a link in the output of a Read, in its own text or in its result, is not listed', () => {
  expect(conversationPrs([readOf(PR5)])).toEqual([])
  expect(conversationPrs([readOf('', 'r2'), resultOf('r2', PR5)])).toEqual([])
})

test('a link in the output of a WebFetch or a Grep is not listed either', () => {
  const fetched: ConversationMessage = { role: 'assistant', text: '', toolUses: [{ tool: 'WebFetch', text: PR5, tool_use_id: 'w1' }, { tool: 'Grep', text: PR5, tool_use_id: 'g1' }] }
  expect(conversationPrs([fetched, resultOf('w1', PR5), resultOf('g1', PR5)])).toEqual([])
})

test('a link in the output of a Bash call is listed, in its own text or in its result', () => {
  expect(conversationPrs([bash('gh pr list', PR5)])).toEqual([{ ref: { slug: 'acme/api', number: 5 }, opened: false }])
  expect(conversationPrs([bash('gh pr list', undefined, 'b2'), resultOf('b2', PR5)])).toEqual([{ ref: { slug: 'acme/api', number: 5 }, opened: false }])
})

test('a link in the assistant\'s own text is not listed', () => {
  expect(conversationPrs([{ role: 'assistant', text: `see ${PR5}`, toolUses: [] }])).toEqual([])
})

test('a result without a call id, or of a call never seen, is not listed', () => {
  const orphan: ConversationMessage = { role: 'user', text: '', toolUses: [], toolResults: [{ text: PR5 }, { tool_use_id: 'ghost', text: PR5 }] }
  expect(conversationPrs([orphan])).toEqual([])
})
