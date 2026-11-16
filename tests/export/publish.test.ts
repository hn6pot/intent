import { expect, test } from 'claude-code/testing'
import { artifactOutcome, isArtifactUrl, publishName, standaloneHtml } from '../../hooks/export/publish'
import type { PageData, PageReview } from '../../hooks/model'

// Same shape as page/index.html: a bootstrap script that loads the files with the token, and the question form.
const INDEX = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Revue</title>
  <script>
    (function () {
      var link = document.createElement('link')
      link.href = 'style.css' + query
      var app = document.createElement('script')
      app.src = 'app.js' + query
    })()
  </script>
</head>
<body>
  <header id="top" class="top"></header>
  <main id="main" class="main" role="tabpanel"></main>
  <footer id="ask" class="ask writes" hidden>
    <form id="ask-form" class="ask-form">
      <input id="ask-text" type="text" autocomplete="off">
      <button id="ask-send" type="submit" class="button button-primary"></button>
    </form>
  </footer>
</body>
</html>
`
const CSS = '.top { color: red } /* $& stays */'
// Same shapes as the page's modules: exported consts and functions, named imports, top-level names used in two files.
const TEXTS_JS = "const s = n => (n > 1 ? 's' : '')\nexport const TEXTS = { fr: { n: 2, word: n => `mot${s(n)}` } }\n"
const RENDER_JS = "const s = 'render'\nexport const end = '</script><!-- x'\nexport function twice(n) {\n  return n * 2\n}\n"
const APP_JS = [
  "import { end, twice } from './render.js'",
  "import { TEXTS } from './texts.js'",
  "const s = 'app'",
  "globalThis.__standalone = { twice: twice(TEXTS.fr.n), word: TEXTS.fr.word(2), end, s, dollar: '$&' }",
  '',
].join('\n')

const review = (root: string, name: string, summary = 'Résumé'): PageReview => ({
  root, name, branch: 'feat/x', pr: null, status: 'idle', error: null, summary, intentions: [], chapters: [], files: [], skipped: [], answers: [],
})
const DATA: PageData = {
  lang: 'fr', updatedAt: '2026-10-18T10:00:00.000Z', publish: true,
  published: { '/Users/me/w/app': 'https://claude.ai/artifact/abc' }, publishFailed: {},
  sources: [{ repo: 'a/app', branches: [], prs: [{ number: 3, title: 'T', state: 'open', url: 'https://github.com/a/app/pull/3', group: 'viewed', target: 'pr:a/app#3', reviewed: false, behind: false }] }],
  reviews: [review('/Users/me/w/app', 'app', 'Fin </script><script>alert(1)</script> <!-- là'), review('/Users/me/w/other', 'other')],
}

const MODULES = { './render.js': RENDER_JS, './texts.js': TEXTS_JS }
const html = (app = APP_JS) => standaloneHtml(INDEX, CSS, app, MODULES, DATA, '/Users/me/w/app', '/Users/me')
const between = (text: string, open: string, close: string) => text.slice(text.indexOf(open) + open.length, text.indexOf(close, text.indexOf(open)))
const dataOf = (page: string) => JSON.parse(between(page, '<script type="application/json" id="intent-data">', '</script>'))
const moduleOf = (page: string) => between(page, '<script type="module">', '</script>')

test('one review, read only, nothing to publish, the data inline; the title names the repo', () => {
  const page = html()
  const data = dataOf(page)
  expect(data.reviews.map((r: PageReview) => r.name)).toEqual(['app'])
  expect(data.reviews[0].summary).toBe('Fin </script><script>alert(1)</script> <!-- là')
  expect(data).toMatchObject({ readonly: true, publish: false, published: {}, lang: 'fr' })
  expect(page).toContain('<title>Revue app</title>')
})

test('the copy has no Sources column data, and keeps the PR header data of its review', () => {
  const pr = { number: 3, title: 'T', state: 'open' as const, url: 'https://github.com/a/app/pull/3', narrow: true }
  const withPr = { ...DATA, reviews: [{ ...review('/Users/me/w/app', 'app'), pr }] }
  const data = dataOf(standaloneHtml(INDEX, CSS, APP_JS, MODULES, withPr, '/Users/me/w/app', '/Users/me'))
  expect(data.sources).toEqual([])
  expect(data.reviews[0].pr).toEqual(pr)
})

test('the copy freezes no passing status: the review reads « à jour », without error', () => {
  const failing = { ...DATA, reviews: [{ ...review('/Users/me/w/app', 'app'), status: 'failed' as const, error: 'model' as const }] }
  const page = standaloneHtml(INDEX, CSS, APP_JS, MODULES, failing, '/Users/me/w/app', '/Users/me')
  expect(dataOf(page).reviews[0]).toMatchObject({ status: 'idle', error: null })
  const running = { ...DATA, reviews: [{ ...review('/Users/me/w/app', 'app'), status: 'running' as const }] }
  expect(dataOf(standaloneHtml(INDEX, CSS, APP_JS, MODULES, running, '/Users/me/w/app', '/Users/me')).reviews[0].status).toBe('idle')
})

test('no absolute path of this Mac: the review is known by its name', () => {
  const page = html()
  expect(page).not.toContain('/Users/')
  expect(dataOf(page).reviews[0].root).toBe('app')
})

test('a module shape the join does not know: no page rather than a blank one', () => {
  expect(() => html(`${APP_JS}export default 1\n`)).toThrow()
  expect(() => html(`import * as all from './render.js'\n${APP_JS}`)).toThrow()
})

test('the copy keeps the finished answers only, their paths made relative to the folder', () => {
  const base = { kind: 'here' as const, path: 'a.ts', lines: [1, 2] as [number, number], error: null, at: '2026-10-19T10:00:00.000Z', moved: false }
  const answers: PageReview['answers'] = [
    { ...base, id: 'a-1', status: 'done', question: 'Dans `/Users/me/w/app/a.ts` lignes 1-2 ?', answer: 'Voir /Users/me/w/app/b.ts:3' },
    { ...base, id: 'a-2', status: 'running', question: 'q', answer: '' },
    { ...base, id: 'a-3', status: 'waiting', question: 'q', answer: '' },
    { ...base, id: 'a-4', status: 'failed', question: 'q', answer: '', error: 'failed' },
  ]
  const data = { ...DATA, reviews: [{ ...review('/Users/me/w/app', 'app'), answers }] }
  const page = standaloneHtml(INDEX, CSS, APP_JS, MODULES, data, '/Users/me/w/app', '/Users/me')
  expect(dataOf(page).reviews[0].answers).toEqual([{ ...answers[0], question: 'Dans `a.ts` lignes 1-2 ?', answer: 'Voir b.ts:3' }])
  expect(page).not.toContain('/Users/')
})

test('the home folder, this one or any /Users/<name>, reads ~ in the questions, the answers and the explanations', () => {
  const base = { kind: 'free' as const, error: null, at: '2026-10-19T10:00:00.000Z', moved: false, status: 'done' as const }
  const answers: PageReview['answers'] = [
    { ...base, id: 'a-1', question: 'Et /Users/me/w/other/b.ts ?', answer: 'Voir /Users/me/w/other/b.ts:3, /Users/first.last/x et /Users/me.' },
  ]
  const note = { intention: null, lines: [1, 2] as [number, number], hunk: '@@ -1 +1 @@', explanation: 'Comme /Users/me/w/other/c.ts et /Users/me/w/app/d.ts' }
  const file = { path: 'a.ts', status: 'modified' as const, importance: 'normal' as const, role: '', binary: false, hunks: [{ id: 'a.ts#0', header: '@@ -1 +1 @@', lines: [], notes: [note] }] }
  const data = { ...DATA, reviews: [{ ...review('/Users/me/w/app', 'app'), answers, files: [file] }] }
  const page = standaloneHtml(INDEX, CSS, APP_JS, MODULES, data, '/Users/me/w/app', '/Users/me')
  expect(dataOf(page).reviews[0].answers[0]).toMatchObject({ question: 'Et ~/w/other/b.ts ?', answer: 'Voir ~/w/other/b.ts:3, ~/x et ~.' })
  expect(dataOf(page).reviews[0].files[0].hunks[0].notes[0].explanation).toBe('Comme ~/w/other/c.ts et d.ts')
  expect(page).not.toContain('/Users/')
  // Another home than /Users (a Linux one): the session's.
  const linux = { ...DATA, reviews: [{ ...review('/home/me/w/app', 'app'), answers: [{ ...answers[0]!, answer: 'Voir /home/me/w/other/b.ts et /home/meg/x' }] }] }
  expect(dataOf(standaloneHtml(INDEX, CSS, APP_JS, MODULES, linux, '/home/me/w/app', '/home/me')).reviews[0].answers[0].answer).toBe('Voir ~/w/other/b.ts et /home/meg/x')
})

test('a page module importing another one: the imported one comes first, and the importer gets its exports', () => {
  const modules = { './render.js': "import { esc } from './escape.js'\nexport const r = x => esc(x)\n", './escape.js': 'export const esc = x => x\n' }
  const code = moduleOf(standaloneHtml(INDEX, CSS, "import { r } from './render.js'\nr(1)\n", modules, DATA, '/Users/me/w/app', '/Users/me'))
  expect(code).toContain("const __module1 = (() => {\nconst esc = x => x\n\nreturn { esc }\n})()\nconst __module0 = (() => {\nconst { esc } = __module1\nconst r = x => esc(x)\n\nreturn { r }\n})()\nconst { r } = __module0")
  expect(code).not.toMatch(/^\s*(import|export)\b/m)
})

test('page modules importing each other: no page rather than a broken one', () => {
  const modules = { './a.js': "import { b } from './b.js'\nexport const a = 1\n", './b.js': "import { a } from './a.js'\nexport const b = 2\n" }
  expect(() => standaloneHtml(INDEX, CSS, "import { a } from './a.js'\n", modules, DATA, '/Users/me/w/app', '/Users/me')).toThrow()
})

test('every module the page imports goes in the copy', () => {
  const app = `import { pick } from './select.js'\n${APP_JS}`
  const code = moduleOf(standaloneHtml(INDEX, CSS, app, { ...MODULES, './select.js': 'export function pick() {}\n' }, DATA, '/Users/me/w/app', '/Users/me'))
  expect(code).toContain('const { pick } = __module2')
})

test('publish name: the folder and the branch, slashes and spaces made dashes', () => {
  expect(publishName('app', 'feat/x')).toBe('app-feat-x')
  expect(publishName('my app', 'fix/a b')).toBe('my-app-fix-a-b')
})

test('no question field, no bootstrap, nothing fetched: the style and the code are inline', () => {
  const page = html()
  expect(page).not.toContain('<input')
  expect(page).not.toContain('<form')
  expect(page).not.toContain("createElement('script')")
  expect(page).not.toMatch(/\b(src|href)=/)
  expect(page).toContain(`<style>${CSS}</style>`)
  expect(page).toContain('<footer id="ask" class="ask writes" hidden>') // app.js still finds its footer, kept hidden
})

test('</script> and <!-- never end or bend an inline block, in the data or in the code', () => {
  const page = html()
  expect(page.match(/<\/script/gi)).toHaveLength(2) // the data block's end and the module's end
  expect(page).not.toContain('<!--')
})

// The kit refuses to evaluate code: the bundle's shape is checked here, and it ran in a browser on the real page files.
test('the modules become one: each runs in its own scope and hands its exports to the imports', () => {
  const code = moduleOf(html())
  expect(code).not.toMatch(/^\s*(import|export)\b/m)
  expect(code).toContain("const __module0 = (() => {\nconst s = 'render'\nconst end = '\\x3C/script>\\x3C!-- x'\nfunction twice(n) {")
  expect(code).toContain('return { end, twice }\n})()')
  expect(code).toContain("const __module1 = (() => {\nconst s = n => (n > 1 ? 's' : '')\nconst TEXTS = ")
  expect(code).toContain('return { TEXTS }\n})()')
  expect(code).toContain("const { end, twice } = __module0\nconst { TEXTS } = __module1\nconst s = 'app'")
  expect(code).toContain("dollar: '$&'")
})

test('artifact outcome: the claude.ai address, a refusal by the tool, or a failure', () => {
  const url = 'https://claude.ai/artifact/abc'
  expect(artifactOutcome({ ref: 'r', result: { url, path: '/f' }, text: '' })).toEqual({ url })
  expect(artifactOutcome({ ref: 'r', result: { error: 'outside' }, text: 'Sources must be under the working directory', isError: true })).toBe('refused')
  expect(artifactOutcome({ deny: 'no' })).toBe('denied')
  expect(artifactOutcome({ ref: 'r', result: { url: 'https://evil.example/x' }, text: '' })).toBe('failed')
  expect(artifactOutcome({ ref: 'r', result: 'ok', text: '' })).toBe('failed')
  expect(artifactOutcome(undefined)).toBe('failed')
})

test('artifact outcome without result.url: the first claude.ai address in the text, or in a string result', () => {
  expect(artifactOutcome({ ref: 'r', result: {}, text: 'Published at https://claude.ai/code/artifact/abc-1. Watching it.' }))
    .toEqual({ url: 'https://claude.ai/code/artifact/abc-1' })
  expect(artifactOutcome({ ref: 'r', result: 'Updated https://claude.ai/artifact/xyz (private)', text: '' }))
    .toEqual({ url: 'https://claude.ai/artifact/xyz' })
  expect(artifactOutcome({ ref: 'r', text: 'see https://evil.example/x and http://claude.ai/artifact/a' })).toBe('failed')
  expect(artifactOutcome({ ref: 'r', result: { url: 'https://evil.example/x' }, text: 'https://claude.ai/artifact/abc' })).toBe('failed')
})

test('artifact address: a claude.ai page over https only', () => {
  expect(isArtifactUrl('https://claude.ai/artifact/abc')).toBe(true)
  expect(isArtifactUrl('http://claude.ai/artifact/abc')).toBe(false)
  expect(isArtifactUrl('https://claude.ai.evil.example/x')).toBe(false)
  expect(isArtifactUrl(undefined)).toBe(false)
})
