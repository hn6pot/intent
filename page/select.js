// Selected code on the review page: the file and new lines the window's selection covers, and the floating button near it.
// Imports nothing: the published copy joins it to app.js as it is.

/** The code row a node sits in, if any. */
const rowOf = node => (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)?.closest('tr[data-new]') ?? null

/**
 * The lines a selection covers, `{ path, from, to, text }`, when it starts and ends on code rows of one hunk; null otherwise.
 * `text` is the rows' code, one per line, `max` characters at most.
 */
export function selectedLines(selection, max) {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  const first = rowOf(range.startContainer)
  const last = rowOf(range.endContainer)
  const body = first?.closest('.hunk-body')
  if (!first || !last || !body || last.closest('.hunk-body') !== body) return null
  const rows = [...body.querySelectorAll('tr[data-new]')]
  const start = rows.indexOf(first)
  let end = rows.indexOf(last)
  // A selection ending at the very start of a row (a triple click does) leaves that row out.
  const head = document.createRange()
  head.setStart(last, 0)
  head.setEnd(range.endContainer, range.endOffset)
  if (end > start && head.toString() === '') end--
  const chosen = rows.slice(start, end + 1)
  if (chosen.length === 0) return null
  const numbers = chosen.map(row => Number(row.dataset.new))
  const text = [...chosen.map(row => row.querySelector('.src')?.textContent ?? '').join('\n')].slice(0, max).join('')
  return { path: first.dataset.path, from: Math.min(...numbers), to: Math.max(...numbers), text }
}

/** The button under the selection, kept inside the page's width; hidden when there is nothing to explain. */
export function placeButton(button, selection, shown) {
  button.hidden = !shown
  if (!shown) return
  const rect = selection.getRangeAt(0).getBoundingClientRect()
  const room = document.documentElement.clientWidth - button.offsetWidth - 8
  button.style.top = `${rect.bottom + window.scrollY + 8}px`
  button.style.left = `${Math.max(8, Math.min(rect.left, room)) + window.scrollX}px`
}
