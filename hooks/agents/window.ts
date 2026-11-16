// The part of a file sent with a question: the lines around the question's, numbered, within a bound.

/** Lines of the file sent at most. */
export const WINDOW_LINES = 600
/** Characters of the file sent at most, line numbers included. */
export const WINDOW_CHARS = 40_000

/** `text`: the numbered lines `from` to `to` (1-based) of a file of `total` lines. */
export type FileWindow = { text: string; from: number; to: number; total: number }

const numbered = (n: number, line: string): string => `${n}: ${line}`

/**
 * The lines around `lines` (1-based, inclusive), each with its number: grown one line below, then one above, from their
 * middle, until 600 lines, the file's ends, or the next line would pass 40 000 characters. A middle line longer than that is cut.
 */
export function fileWindow(text: string, lines: [number, number]): FileWindow {
  const all = (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n')
  const middle = Math.min(Math.max(Math.floor((lines[0] + lines[1]) / 2), 1), all.length)
  const kept = [numbered(middle, all[middle - 1]!).slice(0, WINDOW_CHARS)]
  let chars = kept[0]!.length
  let from = middle
  let to = middle
  const grow = (n: number): boolean => {
    const line = numbered(n, all[n - 1]!)
    if (chars + 1 + line.length > WINDOW_CHARS) return false
    chars += 1 + line.length
    if (n > to) kept.push(line)
    else kept.unshift(line)
    return true
  }
  while (to - from + 1 < WINDOW_LINES) {
    const below = to < all.length && grow(to + 1)
    if (below) to++
    if (to - from + 1 >= WINDOW_LINES) break
    const above = from > 1 && grow(from - 1)
    if (above) from--
    if (!below && !above) break
  }
  return { text: kept.join('\n'), from, to, total: all.length }
}
