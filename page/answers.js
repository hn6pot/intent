// The answers to the questions on the page: their simple Markdown, and where each one stands. Pure HTML strings.
import { escapeHtml } from './escape.js'

/** A link to an https address, whose parentheses may hold one level of balanced ones (`…/A_(b)`). */
const LINK = /\[([^\]]+)\]\((https:\/\/(?:[^\s()]|\([^\s()]*\))+)\)/g
const bold = escaped => escaped.replace(/\*\*(?=\S)(.+?)\*\*/g, '<strong>$1</strong>')

/**
 * Bold and https links in a piece of escaped text without code; nothing else becomes a tag. Links first, set aside as
 * `<n>` (escaped text holds no `<`), so a `**` inside an address never turns into bold.
 */
function inlineHtml(escaped) {
  const links = []
  const marked = escaped.replace(LINK, (_, label, href) => `<${links.push(`<a href="${href}" target="_blank" rel="noopener noreferrer">${bold(label)}</a>`) - 1}>`)
  return bold(marked).replace(/<(\d+)>/g, (_, n) => links[Number(n)])
}

/** One line of escaped text: `code` spans kept as they are, the rest through inlineHtml. */
function spanHtml(escaped) {
  return escaped.split(/(`[^`]+`)/).map((piece, i) => (i % 2 === 1 ? `<code>${piece.slice(1, -1)}</code>` : inlineHtml(piece))).join('')
}

const BULLET = /^\s*[-*]\s+/

/**
 * An answer's simple Markdown, escaped first: paragraphs, bullet lists, `code`, fenced code blocks, **bold**, and links
 * to https addresses. No raw HTML ever comes through.
 */
export function markdownHtml(text) {
  const lines = escapeHtml(text).split('\n')
  const blocks = []
  let paragraph = []
  let list = []
  const flush = () => {
    if (paragraph.length > 0) blocks.push(`<p>${paragraph.map(spanHtml).join('<br>')}</p>`)
    if (list.length > 0) blocks.push(`<ul>${list.map(item => `<li>${spanHtml(item)}</li>`).join('')}</ul>`)
    paragraph = []
    list = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*```/.test(line)) {
      flush()
      const code = []
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i])
      blocks.push(`<pre><code>${code.join('\n')}</code></pre>`)
    } else if (line.trim() === '') flush()
    else if (BULLET.test(line)) {
      if (paragraph.length > 0) flush()
      list.push(line.replace(BULLET, ''))
    } else {
      if (list.length > 0) flush()
      paragraph.push(line)
    }
  }
  flush()
  return blocks.join('')
}

/** An answer: the question recalled in italics, then the answer, or where it stands; a failed one the page can send again (`retryable`) offers « Réessayer ». */
export function answerHtml(answer, texts) {
  const t = texts.answer
  const question = `<p class="answer-question"><em>${escapeHtml(answer.question)}</em></p>`
  let body
  if (answer.status === 'done') {
    const marks = [t.added, ...(answer.moved ? [t.moved] : [])].map(mark => `<span class="answer-mark">${escapeHtml(mark)}</span>`).join('')
    body = `<div class="answer-text">${markdownHtml(answer.answer)}</div><p class="answer-marks">${marks}</p>`
  } else if (answer.status === 'failed') {
    body = `<p class="answer-state answer-reason" role="status">${escapeHtml(t.error[answer.error] ?? t.error.failed)}</p>`
      + (answer.reason ? `<p class="answer-detail">${escapeHtml(answer.reason)}</p>` : '')
      + (answer.retryable ? `<button type="button" class="ask-here writes" data-action="retry" data-answer="${escapeHtml(answer.id)}">${escapeHtml(t.retry)}</button>` : '')
  } else body = `<p class="answer-state" role="status">${escapeHtml(answer.status === 'running' ? t.running : t.waiting)}</p>`
  return `<aside class="answer answer-${answer.status}">${question}${body}</aside>`
}

/** The answers that sit under no code (free questions, code changed since), under « Réponses »; nothing without one. */
export function answersSectionHtml(answers, texts) {
  if (answers.length === 0) return ''
  return `<section class="answers"><h2 class="answers-title">${escapeHtml(texts.answer.heading)}</h2>${answers.map(a => answerHtml(a, texts)).join('')}</section>`
}
