import { expect, test } from 'claude-code/testing'
import type { PageAnswer, PageHunk, PagePr, PageReview, PageSource } from '../../hooks/model'
import {
  artifactHref, chapterHtml, githubHref, highlight, hunkHtml, linesText, noteKey, pathOf, pendingText, prHeaderHtml, sourcesHtml, statusHtml, treeHtml,
} from '../../page/render.js'
import { TEXTS } from '../../page/texts.js'

const texts = {
  here: 'Que se passe-t-il ici ?',
  sent: 'Envoyé ✓',
  why: 'Pourquoi',
  conversation: 'conversation',
  inferred: 'déduite',
  otherChanges: 'Autres changements',
  notExplained: 'Non expliqués',
  noDiff: 'Pas de diff à afficher',
  binary: 'Fichier binaire',
  key: 'clé',
  minor: 'mineur',
  added: 'nouveau',
  deleted: 'supprimé',
  renamed: 'renommé',
  answer: TEXTS.fr.answer,
}

const hunk: PageHunk = {
  id: 'src/a.ts#0',
  header: '@@ -10,3 +10,4 @@',
  lines: [
    { kind: 'context', old: 10, new: 10, text: 'const a = 1' },
    { kind: 'del', old: 11, new: null, text: 'old()' },
    { kind: 'add', old: null, new: 11, text: 'const b = "<b>"' },
    { kind: 'context', old: 12, new: 12, text: 'end()' },
  ],
  notes: [{ intention: 2, explanation: 'Adds b & co', lines: [10, 11], hunk: '@@ -9,2 +9,3 @@' }],
}

const review: PageReview = {
  root: '/r',
  name: 'r',
  branch: 'feat/x',
  pr: null,
  status: 'idle',
  error: null,
  summary: 'sum',
  intentions: [
    { id: 1, title: 'Read the diff', why: 'To cover the branch', origin: 'conversation' },
    { id: 2, title: 'Guessed one', why: 'Because', origin: 'inferred' },
  ],
  chapters: [],
  files: [
    { path: 'src/a.ts', status: 'modified', importance: 'key', role: 'core', binary: false, hunks: [hunk] },
    { path: 'src/new.ts', status: 'added', importance: 'normal', role: '', binary: false, hunks: [] },
    { path: 'docs/readme.md', status: 'modified', importance: 'minor', role: '', binary: false, hunks: [] },
  ],
  skipped: ['dist/x.js'],
  answers: [],
}

test('highlight colours a string without undoing its escaping', () => {
  const html = highlight('const s = "<b>"', 'a.ts')
  expect(html).toContain('&lt;b&gt;')
  expect(html).not.toContain('<b>')
  expect(html).toContain('<span class="tok-k">const</span>')
  expect(html).toContain('<span class="tok-s">&quot;&lt;b&gt;&quot;</span>')
})

test('highlight colours comments and numbers, and leaves unknown files as escaped text', () => {
  expect(highlight('x = 42 # <c>', 'a.py')).toContain('<span class="tok-c"># &lt;c&gt;</span>')
  expect(highlight('x = 42 # <c>', 'a.py')).toContain('<span class="tok-n">42</span>')
  expect(highlight('if <x> 42', 'notes.txt')).toBe('if &lt;x&gt; 42')
})

test('hunkHtml numbers old and new lines exactly and classes each line', () => {
  const html = hunkHtml(hunk, texts, null)
  expect(html).toMatch(/<tr class="context"[^>]*><td class="ln old">10<\/td><td class="ln new">10<\/td>/)
  expect(html).toMatch(/<tr class="del"[^>]*><td class="ln old">11<\/td><td class="ln new"><\/td>/)
  expect(html).toMatch(/<tr class="add"[^>]*><td class="ln old"><\/td><td class="ln new">11<\/td>/)
  expect(html).toMatch(/<tr class="context"[^>]*><td class="ln old">12<\/td><td class="ln new">12<\/td>/)
})

test('hunkHtml puts a note right after the last line of its range, with its intention and button', () => {
  const html = hunkHtml(hunk, texts, null)
  const note = html.indexOf('class="note')
  expect(note).toBeGreaterThan(html.indexOf('<td class="ln new">11</td>'))
  expect(note).toBeLessThan(html.indexOf('<td class="ln new">12</td>'))
  expect(html).toContain('②')
  expect(html).toContain('Adds b &amp; co')
  expect(html).toContain('Que se passe-t-il ici ?')
  expect(html).toContain('data-path="src/a.ts"')
  expect(html).toContain('data-hunk="@@ -9,2 +9,3 @@"')
})

test('hunkHtml shows « Envoyé ✓ » instead of the button when the note was the last sent', () => {
  const html = hunkHtml(hunk, texts, noteKey('src/a.ts', '@@ -9,2 +9,3 @@'))
  expect(html).toContain('Envoyé ✓')
  expect(html).not.toContain('Que se passe-t-il ici ?')
  // The sent mark keeps the button's data so the focus lands on it after the redraw.
  expect(html).toMatch(/<span class="sent[^"]*"[^>]*data-action="here" data-path="src\/a\.ts" data-hunk="@@ -9,2 \+9,3 @@" tabindex="-1">/)
  expect(hunkHtml(hunk, texts, noteKey('src/a.ts', '@@ -1 +1 @@'))).toContain('Que se passe-t-il ici ?')
})

test('chapterHtml shows the intention title, its why and « déduite » for an inferred one', () => {
  const inferred = chapterHtml({ intention: review.intentions[1]!, hunks: ['src/a.ts#0'] }, review, texts, null)
  expect(inferred).toContain('Guessed one')
  expect(inferred).toContain('Because')
  expect(inferred).toContain('déduite')
  expect(inferred).toContain('src/a.ts')
  expect(inferred).toContain('<td class="ln new">11</td>')
  const fromConversation = chapterHtml({ intention: review.intentions[0]!, hunks: [] }, review, texts, null)
  expect(fromConversation).toContain('Read the diff')
  expect(fromConversation).not.toContain('déduite')
})

test('chapterHtml titles the chapter without intention « Autres changements »', () => {
  expect(chapterHtml({ intention: null, hunks: ['src/a.ts#0'] }, review, texts, null)).toContain('Autres changements')
})

test('treeHtml tags files key, new and minor, marks the chosen one and lists the files not explained', () => {
  const html = treeHtml(review, 'src/new.ts', texts)
  expect(html).toContain('>clé<')
  expect(html).toContain('>nouveau<')
  expect(html).toContain('>mineur<')
  const chosen = html.match(/<button[^>]*aria-current="true"[^>]*>/g) ?? []
  expect(chosen).toHaveLength(1)
  expect(chosen[0]).toContain('data-path="src/new.ts"')
  expect(html).toContain('Non expliqués')
  expect(html).toContain('dist/x.js')
})

const line = (kind: 'context' | 'add' | 'del', old: number | null, nu: number | null) => ({ kind, old, new: nu, text: `${kind} ${old ?? ''}/${nu ?? ''}` })
const note = (from: number, to: number, explanation: string) => ({ intention: 1, explanation, lines: [from, to] as [number, number], hunk: explanation })
/** The rows of the html, in order: `n:<explanation>` for a note, `<kind> <old>/<new>` for a line. */
const order = (html: string) =>
  [...html.matchAll(/<p class="explanation">([^<]*)<|<td class="src">(.*?)<\/td>/g)].map(m => (m[1] !== undefined ? `n:${m[1]}` : m[2]!.replace(/<[^>]*>/g, '')))

test('hunkHtml: with two adjacent blocks, a note ending on the context line does not take the next block\'s deleted lines', () => {
  const twoBlocks: PageHunk = {
    id: 'a.ts#0',
    header: '@@ -10,5 +10,5 @@',
    lines: [line('context', 10, 10), line('del', 11, null), line('add', null, 11), line('context', 12, 12), line('del', 13, null), line('add', null, 13), line('context', 14, 14)],
    notes: [note(11, 12, 'first'), note(13, 13, 'second')],
  }
  expect(order(hunkHtml(twoBlocks, texts, null))).toEqual([
    'context 10/10', 'del 11/', 'add /11', 'context 12/12', 'n:first', 'del 13/', 'add /13', 'n:second', 'context 14/14',
  ])
})

test('hunkHtml: a pure deletion sits on the line before it, its note comes after the deleted lines', () => {
  const deletion: PageHunk = {
    id: 'a.ts#0',
    header: '@@ -3,4 +3,2 @@',
    lines: [line('context', 3, 3), line('del', 4, null), line('del', 5, null), line('context', 6, 4)],
    notes: [note(3, 3, 'gone')],
  }
  expect(order(hunkHtml(deletion, texts, null))).toEqual(['context 3/3', 'del 4/', 'del 5/', 'n:gone', 'context 6/4'])
})

test('artifactHref follows only a claude.ai address over https', () => {
  expect(artifactHref('https://claude.ai/artifact/abc')).toBe('https://claude.ai/artifact/abc')
  expect(artifactHref('http://claude.ai/artifact/abc')).toBeNull()
  expect(artifactHref('https://claude.ai.evil.com/x')).toBeNull()
  expect(artifactHref('https://example.com/artifact')).toBeNull()
  expect(artifactHref('javascript:alert(1)')).toBeNull()
  expect(artifactHref(undefined)).toBeNull()
})

test('pathOf reads the file path of a hunk id, even with a # in the path', () => {
  expect(pathOf('src/a.ts#0')).toBe('src/a.ts')
  expect(pathOf('docs/#notes.md#12')).toBe('docs/#notes.md')
})

test('statusHtml: the review status as a pill, the failure reason when it failed', () => {
  const t = TEXTS.fr
  expect(statusHtml(review, t, false)).toBe('<span class="status status-idle" role="status">à jour</span>')
  expect(statusHtml({ ...review, status: 'failed', error: 'model' }, t, false)).toContain("échec : le modèle n&#39;a pas répondu")
  expect(statusHtml(null, t, false)).toBe('')
})

test('statusHtml: offline wins over the review status, with or without a review', () => {
  expect(statusHtml(review, TEXTS.fr, true)).toBe('<span class="status status-offline" role="status">hors ligne</span>')
  expect(statusHtml(null, TEXTS.en, true)).toBe('<span class="status status-offline" role="status">offline</span>')
})

test('pendingText: a folder without review content says its first review is coming or must be refreshed', () => {
  const bare = { ...review, summary: '', intentions: [], chapters: [], files: [], skipped: [] }
  expect(pendingText({ ...bare, status: 'running' }, TEXTS.fr)).toBe('Revue en préparation…')
  expect(pendingText({ ...bare, status: 'failed', error: 'model' }, TEXTS.fr)).toBe('Pas encore de revue : « Mettre à jour » pour la préparer.')
  expect(pendingText({ ...bare, status: 'stale' }, TEXTS.en)).toBe('No review yet: press Refresh to prepare it.')
  expect(pendingText(bare, TEXTS.fr)).toBeNull() // idle and empty: « Aucun changement à expliquer »
  expect(pendingText({ ...review, status: 'running' }, TEXTS.fr)).toBeNull() // a review is there: shown while the next one comes
})

// -- answers to the questions --------------------------------------------------

const answer = (extra: Partial<PageAnswer> = {}): PageAnswer => ({
  id: 'a-1', kind: 'here', path: 'src/a.ts', lines: [10, 11], question: 'Que fait <b> ?', answer: 'Voici.', status: 'done', error: null,
  at: '2026-10-19T10:00:00.000Z', moved: false, ...extra,
})

test('hunkHtml: an answer about lines of the hunk comes after its last line, after the note of the review', () => {
  const html = hunkHtml(hunk, texts, null, [answer({ lines: [10, 11] }), answer({ id: 'a-2', path: 'src/other.ts', question: 'ailleurs' })])
  const note = html.indexOf('class="note')
  const placed = html.indexOf('class="answer')
  expect(placed).toBeGreaterThan(note)
  expect(placed).toBeLessThan(html.indexOf('<td class="ln new">12</td>'))
  expect(html).not.toContain('ailleurs')
})

test('hunkHtml: a selection answer sits after its own last line; a moved answer and a free one stay out of the hunk', () => {
  const html = hunkHtml(hunk, texts, null, [
    answer({ kind: 'selection', lines: [12, 12], question: 'sélection' }),
    answer({ id: 'a-2', moved: true, question: 'déplacée' }),
    answer({ id: 'a-3', kind: 'free', question: 'libre' }),
  ])
  expect(html.indexOf('sélection')).toBeGreaterThan(html.indexOf('<td class="ln new">12</td>'))
  expect(html).not.toContain('déplacée')
  expect(html).not.toContain('libre')
})

test('each code line carries its file and new line number; a deleted line the one it sits on', () => {
  const html = hunkHtml(hunk, texts, null)
  expect(html).toContain('<tr class="context" data-path="src/a.ts" data-new="10">')
  // A deleted line followed by added lines belongs to them: the first added line.
  expect(html).toContain('<tr class="del" data-path="src/a.ts" data-new="11">')
  const deletion: PageHunk = { ...hunk, header: '@@ -3,4 +3,2 @@', lines: [line('context', 3, 3), line('del', 4, null), line('context', 5, 4)], notes: [] }
  // A pure deletion sits on the line before it.
  expect(hunkHtml(deletion, texts, null)).toContain('<tr class="del" data-path="src/a.ts" data-new="3">')
})

test('linesText: the text of a file\'s lines from..to, as the selection sends it', () => {
  expect(linesText(review.files[0]!, 11, 12)).toBe('old()\nconst b = "<b>"\nend()')
  expect(linesText(review.files[0]!, 40, 50)).toBe('')
})

// -- sources -------------------------------------------------------------------------

const prRow = (number: number, extra: Partial<PageSource['prs'][number]> = {}): PageSource['prs'][number] => ({
  number, title: `Title ${number}`, state: 'open', url: `https://github.com/a/app/pull/${number}`, group: 'conversation', target: `pr:a/app#${number}`,
  reviewed: true, behind: false, ...extra,
})
const source = (prs: PageSource['prs'], extra: Partial<PageSource> = {}): PageSource => ({
  repo: 'a/app', branches: [{ root: '/w/app', name: 'app', branch: 'feat/x' }], prs, ...extra,
})

test('sources: each repo shows its branch, then its two headings with their own PRs', () => {
  const html = sourcesHtml([source([prRow(3), prRow(5, { group: 'viewed' }), prRow(4)])], '/w/app', TEXTS.fr)
  const at = (text: string) => html.indexOf(text)
  expect(html).toContain('PR de cette conversation')
  expect(html).toContain('PR regardées')
  expect(html).toContain('Branche en cours')
  expect(at('Branche en cours')).toBeLessThan(at('PR de cette conversation'))
  expect(at('PR de cette conversation')).toBeLessThan(at('Title 3'))
  expect(at('Title 3')).toBeLessThan(at('Title 4'))
  expect(at('Title 4')).toBeLessThan(at('PR regardées'))
  expect(at('PR regardées')).toBeLessThan(at('Title 5'))
  expect(html).toContain('feat/x')
  expect(html).toContain('data-action="source" data-root="pr:a/app#3"')
  expect(html).toContain('data-action="source" data-root="/w/app"')
})

test('sources: a heading without PRs is not shown, in either language', () => {
  const onlyViewed = sourcesHtml([source([prRow(5, { group: 'viewed' })])], null, TEXTS.fr)
  expect(onlyViewed).not.toContain('PR de cette conversation')
  expect(onlyViewed).toContain('PR regardées')
  const onlyConversation = sourcesHtml([source([prRow(5)])], null, TEXTS.en)
  expect(onlyConversation).toContain("This conversation&#39;s PRs")
  expect(onlyConversation).not.toContain('Viewed PRs')
  const none = sourcesHtml([source([])], null, TEXTS.fr)
  expect(none).not.toContain('PR de cette conversation')
  expect(none).not.toContain('PR regardées')
})

test('sources: the PR state pills, « à revoir » without review, « nouveau commit » when behind', () => {
  const html = sourcesHtml([source([
    prRow(1, { state: 'merged' }), prRow(2, { state: 'closed', reviewed: false }), prRow(3, { state: null, behind: true }), prRow(4),
  ])], null, TEXTS.fr)
  const row = (n: number) => html.slice(html.indexOf(`data-root="pr:a/app#${n}"`)).split('</button>')[0]!
  expect(row(1)).toContain('pr-state-merged')
  expect(row(1)).toContain('fusionnée')
  expect(row(2)).toContain('pr-state-closed')
  expect(row(2)).toContain('fermée')
  expect(row(2)).toContain('à revoir')
  expect(row(3)).toContain('pr-state-null')
  expect(row(3)).toContain('inaccessible')
  expect(row(3)).toContain('nouveau commit')
  expect(row(3)).not.toContain('à revoir')
  expect(row(4)).toContain('pr-state-open')
  expect(row(4)).toContain('ouverte')
  expect(row(4)).not.toContain('à revoir')
  expect(row(4)).not.toContain('nouveau commit')
})

test('sources: the chosen target is marked, a locked one is disabled', () => {
  const html = sourcesHtml([source([prRow(3), prRow(4)])], 'pr:a/app#4', TEXTS.fr, new Set(['pr:a/app#3']))
  const row = (n: number) => html.slice(html.indexOf(`data-root="pr:a/app#${n}"`)).split('</button>')[0]!
  expect(row(4)).toContain('aria-current="true"')
  expect(row(3)).not.toContain('aria-current')
  expect(row(3)).toContain(' disabled')
  expect(row(4)).not.toContain(' disabled')
})

test('sources: everything from GitHub or the disk is escaped', () => {
  const html = sourcesHtml([source([prRow(1, { title: '<img src=x onerror=alert(1)>', target: 'pr:a/app#1"><b>' })], {
    repo: '<script>x</script>', branches: [{ root: '/w/"><i>', name: '<u>n</u>', branch: '"><svg onload=1>' }],
  })], null, TEXTS.fr)
  expect(html).not.toMatch(/<(img|script|b|i|u|svg)[\s>]/)
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
})

const pr = (extra: Partial<PagePr> = {}): PagePr => ({ number: 12, title: 'Add <b>x</b>', state: 'open', url: 'https://github.com/a/app/pull/12', narrow: false, ...extra })

test('PR header: number, title, state and a link to GitHub, everything escaped', () => {
  const html = prHeaderHtml(pr(), TEXTS.fr)
  expect(html).toContain('PR #12')
  expect(html).toContain('Add &lt;b&gt;x&lt;/b&gt;')
  expect(html).not.toContain('<b>')
  expect(html).toContain('ouverte')
  expect(html).toContain('href="https://github.com/a/app/pull/12"')
  expect(html).toContain('rel="noopener noreferrer"')
  expect(html).toContain('Voir sur GitHub ↗')
  expect(html).not.toContain('Diff de GitHub')
})

test('PR header: a url that is not on https://github.com/ is no link, whatever it looks like', () => {
  for (const url of ['javascript:alert(1)', 'http://github.com/a/b/pull/1', 'https://github.com.evil.example/a', 'https://evil.example/https://github.com/', ' https://github.com/a', '']) {
    expect(prHeaderHtml(pr({ url }), TEXTS.fr)).not.toContain('<a ')
    expect(githubHref(url)).toBeNull()
  }
  expect(githubHref('https://github.com/a/b/pull/1')).toBe('https://github.com/a/b/pull/1')
})

test('PR header: gh never answered, the pill says « inaccessible »; a narrow diff says its context', () => {
  const html = prHeaderHtml(pr({ state: null, title: '', narrow: true }), TEXTS.fr)
  expect(html).toContain('inaccessible')
  expect(html).toContain('Diff de GitHub, 3 lignes de contexte')
  expect(prHeaderHtml(pr({ narrow: true }), TEXTS.en)).toContain('GitHub diff, 3 lines of context')
  expect(prHeaderHtml(null, TEXTS.fr)).toBe('')
})
