import { expect, test } from 'claude-code/testing'
import type { PageAnswer } from '../../hooks/model'
import { answerHtml, answersSectionHtml, markdownHtml } from '../../page/answers.js'
import { TEXTS } from '../../page/texts.js'

const texts = { answer: TEXTS.fr.answer }

const answer = (extra: Partial<PageAnswer & { retryable: boolean }> = {}): PageAnswer => ({
  id: 'a-1', kind: 'here', path: 'src/a.ts', lines: [10, 11], question: 'Que fait <b> ?', answer: 'Voici.', status: 'done', error: null,
  at: '2026-10-19T10:00:00.000Z', moved: false, ...extra,
})

test('markdownHtml escapes everything first: no tag, no script, no javascript: link comes from the answer', () => {
  const html = markdownHtml('<script>alert(1)</script> <img src=x onerror=alert(1)> [x](javascript:alert(1)) [y](http://a.b) "q"')
  expect(html).not.toContain('<script')
  expect(html).not.toContain('<img')
  expect(html).not.toContain('<a')
  expect(html).toContain('&lt;script&gt;')
  expect(html).toContain('[x](javascript:alert(1))')
})

test('markdownHtml renders paragraphs, bullet lists, inline code, fenced code, bold and https links', () => {
  const html = markdownHtml('Un **gras** et `a<b`.\nSuite.\n\n- un\n* deux `x`\n\n```ts\nif (a < b) **no**\n```\n\nVoir [la doc](https://ex.com/a?b=1&c="2")')
  expect(html).toContain('<p>Un <strong>gras</strong> et <code>a&lt;b</code>.<br>Suite.</p>')
  expect(html).toContain('<ul><li>un</li><li>deux <code>x</code></li></ul>')
  expect(html).toContain('<pre><code>if (a &lt; b) **no**</code></pre>')
  expect(html).toContain('<a href="https://ex.com/a?b=1&amp;c=&quot;2&quot;" target="_blank" rel="noopener noreferrer">la doc</a>')
})

test('markdownHtml: no bold or link inside inline code', () => {
  expect(markdownHtml('`**x** [a](https://b.c)`')).toBe('<p><code>**x** [a](https://b.c)</code></p>')
})

test('answerHtml: the question recalled in italics, the answer rendered, marked « ajoutée à ta demande »', () => {
  const html = answerHtml(answer({ answer: '- un **point**' }), texts)
  expect(html).toContain('<em>Que fait &lt;b&gt; ?</em>')
  expect(html).toContain('<li>un <strong>point</strong></li>')
  expect(html).toContain('ajoutée à ta demande')
  expect(html).not.toContain('le code a changé depuis')
  expect(answerHtml(answer({ moved: true }), texts)).toContain('le code a changé depuis')
})

test('answerHtml: waiting, running, and failed with its reason and « Réessayer »', () => {
  expect(answerHtml(answer({ status: 'waiting', answer: '' }), texts)).toContain('en attente')
  const running = answerHtml(answer({ status: 'running', answer: '' }), texts)
  expect(running).toContain('⟳ réponse en cours…')
  expect(running).not.toContain('Réessayer')
  const failed = answerHtml(answer({ status: 'failed', answer: '', error: 'interrupted', retryable: true }), texts)
  expect(failed).toContain('interrompue')
  expect(failed).toMatch(/<button type="button" class="[^"]*writes[^"]*" data-action="retry" data-answer="a-1">Réessayer<\/button>/)
})

test('answersSectionHtml: the answers under « Réponses », nothing when there are none', () => {
  const html = answersSectionHtml([answer({ kind: 'free', question: 'libre' }), answer({ id: 'a-2', moved: true, question: 'déplacée' })], texts)
  expect(html).toContain('Réponses')
  expect(html).toContain('libre')
  expect(html).toContain('déplacée')
  expect(html).toContain('le code a changé depuis')
  expect(answersSectionHtml([], texts)).toBe('')
})

test('answerHtml: no « Réessayer » when the page could not send the question again', () => {
  const failed = answerHtml(answer({ status: 'failed', answer: '', error: 'failed' }), texts)
  expect(failed).toContain('class="answer-state answer-reason"')
  expect(failed).not.toContain('Réessayer')
})

test('markdownHtml: a link is read before bold, so ** inside an address stays in it', () => {
  expect(markdownHtml('[a](https://x/**y**)')).toBe('<p><a href="https://x/**y**" target="_blank" rel="noopener noreferrer">a</a></p>')
  expect(markdownHtml('**[a](https://x)** et **b**')).toBe('<p><strong><a href="https://x" target="_blank" rel="noopener noreferrer">a</a></strong> et <strong>b</strong></p>')
})

test('markdownHtml: an address keeps its balanced parentheses, and the sentence its own', () => {
  expect(markdownHtml('[w](https://en.wikipedia.org/wiki/A_(b))')).toContain('<a href="https://en.wikipedia.org/wiki/A_(b)"')
  expect(markdownHtml('(voir [a](https://x/y))')).toBe('<p>(voir <a href="https://x/y" target="_blank" rel="noopener noreferrer">a</a>)</p>')
})

test('answerHtml: a failed answer shows why the model gave none, escaped', () => {
  const html = answerHtml(answer({ status: 'failed', answer: '', error: 'failed', reason: 'api-error <529> (overloaded)' }), texts)
  expect(html).toContain('échec')
  expect(html).toContain('<p class="answer-detail">api-error &lt;529&gt; (overloaded)</p>')
  expect(answerHtml(answer({ status: 'failed', answer: '', error: 'failed' }), texts)).not.toContain('answer-detail')
})
