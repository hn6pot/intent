// Pure HTML builders of the review page: data in, escaped HTML strings out. No DOM, no fetch.
import { answerHtml } from './answers.js'
import { escapeHtml } from './escape.js'

const CIRCLED = ['①', '②', '③', '④', '⑤']

/** The circled digit of an intention (the review holds 1 to 5), the plain number past that. */
export const circled = id => CIRCLED[id - 1] ?? String(id)

/** What identifies a « What's happening here? » question inside one folder: the app adds the folder. */
export const noteKey = (path, hunk) => `${path}|${hunk}`

/** The file path of a page hunk id (`<path>#<n>`). */
export const pathOf = hunkId => hunkId.slice(0, hunkId.lastIndexOf('#'))

/** The artifact address, only when it is a claude.ai page over https; null otherwise (never a link elsewhere). */
export const artifactHref = href => (typeof href === 'string' && /^https:\/\/claude\.ai\//.test(href) ? href : null)

/** A GitHub address, only when it starts with `https://github.com/`; null otherwise (never a link elsewhere, never `javascript:`). */
export const githubHref = href => (typeof href === 'string' && /^https:\/\/github\.com\/[^\s"'<>]/.test(href) ? href : null)

// -- sources -----------------------------------------------------------------

/** The word and the class of a PR's state; a PR gh never answered for (state null) is « inaccessible ». */
function prStateHtml(state, texts) {
  const key = state === 'open' || state === 'merged' || state === 'closed' ? state : 'null'
  return `<span class="pr-state pr-state-${key}">${escapeHtml(texts.prState[key])}</span>`
}

/** One row of the column: a button that chooses `root`; `current` marks the chosen one, `locked` the one whose refresh is under way. */
function sourceRow(root, inner, current, locked, extraClass) {
  return `<li><button type="button" class="source ${extraClass}${root === current ? ' selected' : ''}" data-action="source" data-root="${escapeHtml(root)}"`
    + `${root === current ? ' aria-current="true"' : ''}${locked.has(root) ? ' disabled' : ''}>${inner}</button></li>`
}

function prRowHtml(pr, current, texts, locked) {
  const inner = `<span class="pr-num">#${escapeHtml(pr.number)}</span><span class="pr-title">${escapeHtml(pr.title)}</span>`
    + `<span class="pr-tags">${prStateHtml(pr.state, texts)}`
    + `${pr.reviewed ? '' : `<span class="pr-tag pr-tag-todo">${escapeHtml(texts.prToReview)}</span>`}`
    + `${pr.behind ? `<span class="pr-tag pr-tag-behind">${escapeHtml(texts.prBehind)}</span>` : ''}</span>`
  return sourceRow(pr.target, inner, current, locked, 'source-pr')
}

/**
 * The Sources column: per repo, the branch in progress, then « PR de cette conversation » and « PR regardées » with their PRs
 * (a heading without PR is left out). `current` is the chosen root; `locked` the roots whose refresh is under way.
 */
export function sourcesHtml(sources, current, texts, locked = new Set()) {
  const repos = sources.map(source => {
    const branches = source.branches.map(b => sourceRow(b.root, `<span class="source-name">${escapeHtml(b.name)}</span><span class="source-branch-name">${escapeHtml(b.branch)}</span>`, current, locked, 'source-branch')).join('')
    const part = (label, group) => {
      const rows = source.prs.filter(pr => pr.group === group).map(pr => prRowHtml(pr, current, texts, locked)).join('')
      return rows === '' ? '' : `<p class="source-label">${escapeHtml(label)}</p><ul class="source-list">${rows}</ul>`
    }
    const here = branches === '' ? '' : `<p class="source-label">${escapeHtml(texts.branchHere)}</p><ul class="source-list">${branches}</ul>`
    return `<section class="source-repo"><h2 class="source-repo-name">${escapeHtml(source.repo)}</h2>${here}${part(texts.conversationPrs, 'conversation')}${part(texts.viewedPrs, 'viewed')}</section>`
  })
  return `<nav class="sources-nav" aria-label="${escapeHtml(texts.sources)}">${repos.join('')}</nav>`
}

/** « PR #n · title · state · View on GitHub ↗ » for the header of a review of a PR (or of a folder whose branch has one); empty without a PR. */
export function prHeaderHtml(pr, texts) {
  if (!pr) return ''
  const href = githubHref(pr.url)
  const parts = [
    `<span class="pr-head-num">PR #${escapeHtml(pr.number)}</span>`,
    ...(pr.title === '' ? [] : [`<span class="pr-head-title">${escapeHtml(pr.title)}</span>`]),
    prStateHtml(pr.state, texts),
    ...(href === null ? [] : [`<a class="pr-head-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(texts.openOnGitHub)} ↗</a>`]),
  ]
  const narrow = pr.narrow ? `<p class="pr-head-narrow">${escapeHtml(texts.narrowDiff)}</p>` : ''
  return `<div class="pr-head"><p class="pr-head-line">${parts.join('<span class="sep" aria-hidden="true">·</span>')}</p>${narrow}</div>`
}

// -- status ---------------------------------------------------------------

/** The status pill of a review (the failure reason when it failed); « hors ligne » instead while the server does not answer. */
export function statusHtml(review, texts, offline) {
  if (offline) return `<span class="status status-offline" role="status">${escapeHtml(texts.offline)}</span>`
  if (!review) return ''
  const word = review.status === 'failed' && review.error ? texts.failed(texts.failure[review.error] ?? review.error) : texts.status[review.status]
  return `<span class="status status-${review.status}" role="status">${escapeHtml(word ?? review.status)}</span>`
}

/** A folder without review content while its first review is under way, failed or behind: what to say instead of the empty text. */
export function pendingText(review, texts) {
  if (review.status === 'idle' || review.summary !== '' || review.files.length > 0) return null
  return review.status === 'running' ? texts.preparing : texts.notYet
}

// -- syntax colouring ------------------------------------------------------

const words = list => `\\b(?:${list.split(' ').join('|')})\\b`
const NUMBER = String.raw`\b(?:0[xX][\da-fA-F]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\b`
const QUOTED = String.raw`"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?`

const JS_WORDS = 'as async await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof interface let new null of return static super switch this throw true try type typeof undefined var void while yield'
const PY_WORDS = 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return self True try while with yield'

// Each language: [group class, pattern] in priority order; the first group that matches wins.
const LANGUAGES = {
  js: [
    ['c', String.raw`\/\/.*|\/\*.*?(?:\*\/|$)`],
    ['s', `${QUOTED}|\`(?:[^\`\\\\]|\\\\.)*\`?`],
    ['n', NUMBER],
    ['k', words(JS_WORDS)],
  ],
  py: [
    ['c', '#.*'],
    ['s', QUOTED],
    ['n', NUMBER],
    ['k', words(PY_WORDS)],
  ],
  json: [
    ['s', QUOTED],
    ['n', String.raw`-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b`],
    ['k', words('true false null')],
  ],
  css: [
    ['c', String.raw`\/\*.*?(?:\*\/|$)`],
    ['s', QUOTED],
    ['k', String.raw`@[\w-]+|!important|#[\da-fA-F]{3,8}\b`],
    ['n', String.raw`-?\b\d+(?:\.\d+)?(?:%|[a-z]+)?`],
  ],
  md: [
    ['k', String.raw`^\s{0,3}#{1,6}\s.*|^\s*(?:[-*+]|\d+\.)\s`],
    ['s', '`[^`]*`?'],
    ['n', String.raw`\*\*[^*]+\*\*`],
  ],
}
const EXTENSIONS = { ts: 'js', tsx: 'js', js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', py: 'py', json: 'json', css: 'css', md: 'md' }
const PATTERNS = {}
for (const [name, rules] of Object.entries(LANGUAGES)) {
  PATTERNS[name] = { classes: rules.map(r => r[0]), regex: new RegExp(rules.map(r => `(${r[1]})`).join('|'), 'g') }
}

/** One line of code as HTML: light colouring by file extension; every piece, coloured or not, is escaped. */
export function highlight(text, path) {
  const extension = /\.([a-z]+)$/i.exec(path)?.[1]?.toLowerCase() ?? ''
  const language = PATTERNS[EXTENSIONS[extension]]
  if (!language) return escapeHtml(text)
  let html = ''
  let last = 0
  for (const match of text.matchAll(language.regex)) {
    const group = match.findIndex((value, i) => i > 0 && value !== undefined)
    html += escapeHtml(text.slice(last, match.index))
    html += `<span class="tok-${language.classes[group - 1]}">${escapeHtml(match[0])}</span>`
    last = match.index + match[0].length
  }
  return html + escapeHtml(text.slice(last))
}

// -- hunks and notes ---------------------------------------------------------

const SIGNS = { add: '+', del: '−', context: ' ', meta: ' ' }

/**
 * The new line each line of a hunk counts as, for a selection: its own; for a deleted line, the added line replacing it
 * (as git prints a changed block: its - lines then its + lines), else the line it sits after, else the hunk's start; null for a meta line.
 */
export function newLines(hunk) {
  const start = Math.max(1, Number(/\+(\d+)/.exec(hunk.header)?.[1] ?? 1))
  const lines = hunk.lines
  let before = null
  return lines.map((line, i) => {
    if (line.kind === 'meta') return null
    if (line.new !== null) return (before = line.new)
    let next = i + 1
    while (next < lines.length && (lines[next].kind === 'del' || lines[next].kind === 'meta')) next++
    if (lines[next]?.kind === 'add') return lines[next].new
    return before ?? lines.slice(i).find(l => l.new !== null)?.new ?? start
  })
}

/** The text of a file's lines whose new line falls in from..to, one per row: what a selection of them sends. */
export function linesText(file, from, to) {
  return file.hunks.flatMap(hunk => {
    const numbers = newLines(hunk)
    return hunk.lines.filter((_, i) => numbers[i] !== null && numbers[i] >= from && numbers[i] <= to).map(line => line.text)
  }).join('\n')
}

/** A code row carries its file and new line (`at`): the page maps a selection to lines with them. */
function lineHtml(line, path, at) {
  const code = line.kind === 'meta' ? escapeHtml(line.text) : highlight(line.text, path)
  const data = at === null ? '' : ` data-path="${escapeHtml(path)}" data-new="${at}"`
  return `<tr class="${line.kind}"${data}><td class="ln old">${line.old ?? ''}</td><td class="ln new">${line.new ?? ''}</td>`
    + `<td class="sign" aria-hidden="true">${SIGNS[line.kind]}</td><td class="src">${code}</td></tr>`
}

/** The index of the line a note goes after: the last line of its range, plus the deleted lines sitting on it. */
function noteSpot(lines, [from, to]) {
  let spot = -1
  lines.forEach((line, i) => {
    if (line.new !== null && line.new >= from && line.new <= to) spot = i
  })
  // No numbered line inside the range: after the last one before it.
  if (spot === -1) lines.forEach((line, i) => {
    if (line.new !== null && line.new <= to) spot = i
  })
  if (spot === -1) return lines.length - 1
  // git prints a changed block as its - lines then its + lines: deleted lines right after the range end are
  // a pure deletion sitting on it (they belong to the note) unless + lines follow, which makes them the next block.
  let end = spot
  while (end + 1 < lines.length && (lines[end + 1].kind === 'del' || lines[end + 1].kind === 'meta')) end++
  return lines[end + 1]?.kind === 'add' ? spot : end
}

function noteHtml(note, path, texts, sentKey) {
  const badge = note.intention === null ? '' : `<span class="badge" aria-hidden="true">${circled(note.intention)}</span>`
  // The sent mark keeps the button's data: the focus finds it again after the redraw.
  const data = `data-action="here" data-path="${escapeHtml(path)}" data-hunk="${escapeHtml(note.hunk)}"`
  const action = noteKey(path, note.hunk) === sentKey
    ? `<span class="sent writes" role="status" ${data} tabindex="-1">${escapeHtml(texts.sent)}</span>`
    : `<button type="button" class="ask-here writes" ${data}>${escapeHtml(texts.here)}</button>`
  return `<aside class="note">${badge}<p class="explanation">${escapeHtml(note.explanation)}</p>${action}</aside>`
}

const table = rows => `<div class="lines"><table><tbody>${rows.join('')}</tbody></table></div>`

const NEW_RANGE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/

/** Whether lines from..to meet the hunk's new side, as the mod decides an answer has not moved (a pure deletion sits on its start line). */
function holds(hunk, [from, to]) {
  const match = NEW_RANGE.exec(hunk.header)
  if (!match) return false
  const start = Number(match[1])
  const last = Math.max(start, start + (match[2] === undefined ? 1 : Number(match[2])) - 1)
  return from <= last && to >= start
}

/**
 * A hunk: numbered old/new lines; each note after the last line of its range, then the answers about lines of this hunk
 * (`answers`: the review's; free and moved ones stay out). `sentKey` is the noteKey of the last question sent about this folder.
 */
export function hunkHtml(hunk, texts, sentKey, answers = []) {
  const path = pathOf(hunk.id)
  const after = new Map()
  const place = (lines, html) => {
    const spot = noteSpot(hunk.lines, lines)
    after.set(spot, [...(after.get(spot) ?? []), html])
  }
  for (const note of hunk.notes) place(note.lines, noteHtml(note, path, texts, sentKey))
  for (const answer of answers) {
    if (answer.kind !== 'free' && !answer.moved && answer.path === path && answer.lines && holds(hunk, answer.lines)) place(answer.lines, answerHtml(answer, texts))
  }
  const numbers = newLines(hunk)
  const digits = String(Math.max(1, ...hunk.lines.map(l => Math.max(l.old ?? 0, l.new ?? 0)))).length
  let html = ''
  let rows = []
  hunk.lines.forEach((line, i) => {
    rows.push(lineHtml(line, path, numbers[i]))
    const placed = after.get(i)
    if (!placed) return
    html += table(rows) + placed.join('')
    rows = []
  })
  if (rows.length > 0) html += table(rows)
  return `<div class="hunk-body" style="--digits:${digits}ch">${html}</div>`
}

// -- files -----------------------------------------------------------------------

/** The words beside a file: its status, then its importance. */
function tagsHtml(file, texts) {
  const tags = []
  if (file.status === 'added') tags.push(['added', texts.added])
  if (file.status === 'deleted') tags.push(['deleted', texts.deleted])
  if (file.status === 'renamed') tags.push(['renamed', texts.renamed])
  if (file.importance === 'key') tags.push(['key', texts.key])
  if (file.importance === 'minor') tags.push(['minor', texts.minor])
  return tags.map(([kind, word]) => `<span class="tag tag-${kind}">${escapeHtml(word)}</span>`).join('')
}

/** A path with its folder dimmed and its name stressed. */
function pathHtml(path) {
  const cut = path.lastIndexOf('/') + 1
  return `<span class="path"><span class="dir">${escapeHtml(path.slice(0, cut))}</span><span class="name">${escapeHtml(path.slice(cut))}</span></span>`
}

/** A file's header: path (old path for a rename), tags, and the hunk header when given. */
export function fileHeadHtml(file, texts, hunkHeader) {
  const old = file.oldPath ? `<span class="old-path">${escapeHtml(file.oldPath)} →</span>` : ''
  const header = hunkHeader ? `<code class="hunk-header">${escapeHtml(hunkHeader)}</code>` : ''
  return `<header class="file-head">${old}${pathHtml(file.path)}${tagsHtml(file, texts)}${header}</header>`
}

/** A file without lines to show: binary, or absent from the wide diff. */
export function emptyFileHtml(file, texts) {
  return `<p class="empty">${escapeHtml(file.binary ? texts.binary : texts.noDiff)}</p>`
}

// -- story -----------------------------------------------------------------------

/** A chapter of the story: the intention (or « other changes »), then each of its hunks with its file. */
export function chapterHtml(chapter, review, texts, sentKey) {
  const hunks = new Map()
  for (const file of review.files) for (const hunk of file.hunks) hunks.set(hunk.id, { file, hunk })
  const intention = chapter.intention
  const id = intention ? `chapter-${intention.id}` : 'chapter-other'
  const head = intention
    ? `<span class="badge badge-big" aria-hidden="true">${circled(intention.id)}</span>`
      + `<div class="chapter-titles"><h2>${escapeHtml(intention.title)}</h2>`
      + `<span class="origin origin-${intention.origin}">${escapeHtml(intention.origin === 'inferred' ? texts.inferred : texts.conversation)}</span></div>`
    : `<span class="badge badge-big badge-other" aria-hidden="true">·</span><div class="chapter-titles"><h2>${escapeHtml(texts.otherChanges)}</h2></div>`
  const why = intention && intention.why ? `<p class="why"><strong>${escapeHtml(texts.why)}</strong> ${escapeHtml(intention.why)}</p>` : ''
  const body = chapter.hunks
    .map(hunkId => hunks.get(hunkId))
    .filter(Boolean)
    .map(({ file, hunk }) => `<article class="hunk">${fileHeadHtml(file, texts, hunk.header)}${hunkHtml(hunk, texts, sentKey, review.answers)}</article>`)
    .join('')
  return `<section class="chapter" id="${id}"><header class="chapter-head">${head}</header>${why}${body}</section>`
}

// -- tree ------------------------------------------------------------------------------

/** Counts of added and deleted lines of a file. */
function counts(file) {
  let add = 0
  let del = 0
  for (const hunk of file.hunks) for (const line of hunk.lines) {
    if (line.kind === 'add') add++
    if (line.kind === 'del') del++
  }
  return `<span class="counts">${add ? `<span class="plus">+${add}</span>` : ''}${del ? `<span class="minus">−${del}</span>` : ''}</span>`
}

/** Folders as nested maps; a folder holding a single folder is folded into one row (`hooks/page`). */
function buildTree(files) {
  const root = { dirs: new Map(), files: [] }
  for (const file of files) {
    const parts = file.path.split('/')
    let node = root
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] })
      node = node.dirs.get(part)
    }
    node.files.push({ file, name: parts[parts.length - 1] })
  }
  return root
}

function nodeHtml(node, selectedPath, texts) {
  const dirs = [...node.dirs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, dir]) => {
    let label = name
    while (dir.files.length === 0 && dir.dirs.size === 1) {
      const [[child, next]] = dir.dirs.entries()
      label += `/${child}`
      dir = next
    }
    return `<li class="dir"><span class="dir-name">${escapeHtml(label)}/</span>${nodeHtml(dir, selectedPath, texts)}</li>`
  })
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name)).map(({ file, name }) => {
    const chosen = file.path === selectedPath
    return `<li><button type="button" class="file${chosen ? ' selected' : ''}" data-action="select" data-path="${escapeHtml(file.path)}"${chosen ? ' aria-current="true"' : ''}>`
      + `<span class="file-name">${escapeHtml(name)}</span>${tagsHtml(file, texts)}${counts(file)}</button></li>`
  })
  return `<ul>${dirs.join('')}${files.join('')}</ul>`
}

/** The files left out of the review, folded under their count. */
export function skippedHtml(review, texts) {
  if (review.skipped.length === 0) return ''
  return `<details class="skipped"><summary>${escapeHtml(texts.notExplained)} (${review.skipped.length})</summary>`
    + `<ul>${review.skipped.map(path => `<li>${escapeHtml(path)}</li>`).join('')}</ul></details>`
}

/** The files tab's tree: folders, files with their tags, the chosen one marked; files not explained at the bottom. */
export function treeHtml(review, selectedPath, texts) {
  return `<nav class="tree">${nodeHtml(buildTree(review.files), selectedPath, texts)}</nav>${skippedHtml(review, texts)}`
}
