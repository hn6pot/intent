import { expect, test } from 'claude-code/testing'
import { fileWindow, WINDOW_CHARS, WINDOW_LINES } from '../../hooks/agents/window'

const lines = (n: number, text = (i: number) => `line ${i}`) => Array.from({ length: n }, (_, i) => text(i + 1)).join('\n')

test('a short file whole, each line after its number; the last newline ends the file, it adds no line', () => {
  expect(fileWindow('a\nb\nc\n', [2, 2])).toEqual({ text: '1: a\n2: b\n3: c', from: 1, to: 3, total: 3 })
})

test('a long file: 600 lines at most, centred on the question lines', () => {
  const w = fileWindow(lines(2000), [1000, 1010])
  expect(w.to - w.from + 1).toBe(WINDOW_LINES)
  expect(w.from).toBe(1005 - 299)
  expect(w.to).toBe(1005 + 300)
  expect(w.text.split('\n')[0]).toBe(`${w.from}: line ${w.from}`)
  expect(w.total).toBe(2000)
})

test('near an end of the file: the window takes what the other side has', () => {
  const w = fileWindow(lines(2000), [3, 4])
  expect([w.from, w.to]).toEqual([1, 600])
})

test('40 000 characters at most, line numbers included, still centred', () => {
  const w = fileWindow(lines(2000, () => 'x'.repeat(99)), [1000, 1000])
  expect(w.text.length).toBeLessThanOrEqual(WINDOW_CHARS)
  expect(w.to - w.from + 1).toBeLessThan(WINDOW_LINES)
  expect(Math.abs((w.to - 1000) - (1000 - w.from))).toBeLessThanOrEqual(1)
})

test('a middle line longer than the bound is cut to it; lines past the file end are read at its last line', () => {
  const w = fileWindow(`a\n${'y'.repeat(50_000)}\nb`, [2, 2])
  expect(w.text.length).toBe(WINDOW_CHARS)
  expect([w.from, w.to]).toEqual([2, 2])
  expect(fileWindow('a\nb', [9, 12])).toMatchObject({ from: 1, to: 2 })
})
