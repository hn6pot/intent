import { expect, test } from 'claude-code/testing'
import { reduceTranscript, type TranscriptMessage } from '../../hooks/review/transcript'

test('two messages and an Edit give three lines, word for word', () => {
  const messages: TranscriptMessage[] = [
    { role: 'user', text: 'Ajoute un bouton', toolUses: [] },
    { role: 'assistant', text: 'Je modifie le fichier', toolUses: [{ tool: 'Edit', input: { file_path: 'hooks/a.ts', old_string: 'x' } }] },
  ]
  expect(reduceTranscript(messages)).toBe('User: Ajoute un bouton\nClaude: Je modifie le fichier\n  [Edit hooks/a.ts]')
})

test('a tool is named with its notebook path or the start of its command', () => {
  const command = 'a'.repeat(100)
  const messages: TranscriptMessage[] = [
    {
      role: 'assistant',
      text: 'ok',
      toolUses: [
        { tool: 'NotebookEdit', input: { notebook_path: 'n.ipynb' } },
        { tool: 'Bash', input: { command } },
        { tool: 'Read', input: {} },
        { tool: 'Glob' },
      ],
    },
  ]
  expect(reduceTranscript(messages)).toBe(`Claude: ok\n  [NotebookEdit n.ipynb]\n  [Bash ${'a'.repeat(80)}]\n  [Read]\n  [Glob]`)
})

test('a tool output never appears, even when the message carries one', () => {
  const messages = [
    {
      role: 'assistant' as const,
      text: 'lu',
      toolUses: [{ tool: 'Read', input: { file_path: 'a.ts' }, result: 'SECRET-RESULT' }],
      toolResults: [{ output: 'SECRET-OUTPUT' }],
    },
  ]
  const reduced = reduceTranscript(messages)
  expect(reduced).not.toContain('SECRET')
  expect(reduced).toBe('Claude: lu\n  [Read a.ts]')
})

test('40 000 characters are cut to 30 000 at most, at the start of a line, keeping the last message', () => {
  const messages: TranscriptMessage[] = Array.from({ length: 450 }, (_, i) => ({
    role: 'user' as const,
    text: `message ${i} ${'x'.repeat(80)}`,
    toolUses: [],
  }))
  const full = messages.map(m => `User: ${m.text}`).join('\n')
  expect(full.length).toBeGreaterThan(40_000)

  const reduced = reduceTranscript(messages)
  expect(reduced.length).toBeLessThanOrEqual(30_000)
  expect(reduced.startsWith('User: message ')).toBe(true)
  expect(full.endsWith(`\n${reduced}`)).toBe(true)
  expect(reduced.endsWith(`message 449 ${'x'.repeat(80)}`)).toBe(true)
})

test('a short conversation is kept whole', () => {
  expect(reduceTranscript([{ role: 'user', text: 'salut', toolUses: [] }], 100)).toBe('User: salut')
})
