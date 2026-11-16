// The review page: reads review.json, draws the story and files tabs, sends questions back through the server.
import { answersSectionHtml } from './answers.js'
import { escapeHtml } from './escape.js'
import {
  artifactHref, chapterHtml, circled, emptyFileHtml, fileHeadHtml, hunkHtml, linesText, noteKey, pathOf, pendingText, prHeaderHtml, skippedHtml, sourcesHtml,
  statusHtml, treeHtml,
} from './render.js'
import { placeButton, selectedLines } from './select.js'
import { TEXTS } from './texts.js'

const POLL_MS = 2000
const PING_MS = 10000
/** Failed polls in a row before the page says it is offline. */
const OFFLINE_AFTER = 3
/** Characters of selected lines a question may carry, as the server allows. */
const SELECTION_CHARS = 4000
const $ = id => document.getElementById(id)
const inline = $('intent-data') // the standalone export carries its data
const state = {
  token: new URLSearchParams(location.search).get('t') ?? '',
  data: null,
  etag: null,
  tab: 'story',
  root: null,
  want: null, // a chosen root (a click on a source, or the address `#source=…`) whose review is not in the data yet
  preparing: null, // the root whose review a click asked for: « Revue en préparation… » until it comes
  sourcesOpen: false, // the Sources column, folded behind its button on a narrow screen
  selected: new Map(), // root → chosen file path
  scroll: { story: 0, files: 0 },
  // The last question sent, kept here only to say « Envoyé ✓ »: the mod's lock is the real guarantee.
  lastSent: null, // { kind, root, detail }
  pressed: new Set(), // `refresh|root`, `publish|root`: pressed, waiting for the next data
  drawn: { top: '', main: '', sources: '' },
  skippedOpen: false, // the « Non expliqués » list, kept open or closed across redraws
  failures: 0, // polls failed in a row (no answer, or refused: a token changed)
  selection: null, // { path, from, to, text }: the lines « Expliquer cette partie » would send
}

const texts = () => TEXTS[state.data?.lang === 'en' ? 'en' : 'fr']
const url = name => `${name}?t=${encodeURIComponent(state.token)}`
// The page scrolls smoothly for anchors; a redraw must put it back at once.
const jump = y => window.scrollTo({ top: y, behavior: 'instant' })
const sameKey = (a, b) => a !== null && b !== null && a.kind === b.kind && a.root === b.root && a.detail === b.detail

function currentReview() {
  const reviews = state.data?.reviews ?? []
  const wanted = state.want === null ? undefined : reviews.find(r => r.root === state.want)
  if (wanted) {
    state.root = wanted.root
    state.want = state.preparing = null
  }
  // Unless chosen, a folder with something to show: an empty one woken by /intent must not hide the others.
  const review = reviews.find(r => r.root === state.root) ?? reviews.find(r => r.files.length > 0) ?? reviews[0] ?? null
  state.root = review?.root ?? null
  return review
}

// -- drawing ----------------------------------------------------------------------

const offline = () => state.failures >= OFFLINE_AFTER

/** The Sources column shows in the page, not in the published copy, once there is a repo to list. */
const sourcesVisible = () => !state.data?.readonly && (state.data?.sources?.length ?? 0) > 0

const sourcesToggle = t => (sourcesVisible()
  ? `<button type="button" class="button button-link sources-toggle" data-action="sources-toggle" aria-controls="sources" aria-expanded="${state.sourcesOpen}">${escapeHtml(t.sources)}</button>`
  : '')

function topHtml(review, t) {
  if (!review) {
    const toggle = sourcesToggle(t)
    return `<div class="top-row"><h1 class="where"><span class="repo">${escapeHtml(t.title)}</span></h1>${statusHtml(null, t, offline())}`
      + `${toggle ? `<div class="actions">${toggle}</div>` : ''}</div>`
  }
  const data = state.data
  const pressed = action => (state.pressed.has(`${action}|${review.root}`) ? ' disabled' : '')
  const refresh = review.status === 'stale' || review.status === 'failed'
    ? `<button type="button" class="button button-warn writes" data-action="refresh"${pressed('refresh')}>${escapeHtml(t.refresh)}</button>` : ''
  const publish = data.publish ? `<button type="button" class="button button-primary writes" data-action="publish"${pressed('publish')}>${escapeHtml(t.publish)}</button>` : ''
  const failed = data.publishFailed?.[review.root]
  const failure = failed ? `<span class="status status-failed" role="status">${escapeHtml(failed)}</span>` : ''
  const href = artifactHref(data.published?.[review.root])
  const artifact = href
    ? `<a class="button button-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t.artifact)}</a>` : ''
  const tab = (name, label) => `<button type="button" role="tab" id="tab-${name}" aria-controls="main" aria-selected="${state.tab === name}"`
    + ` tabindex="${state.tab === name ? 0 : -1}" data-action="tab" data-tab="${name}">${escapeHtml(label)}</button>`
  return `<div class="top-row"><h1 class="where"><span class="repo">${escapeHtml(review.name)}</span><span class="sep" aria-hidden="true">·</span>`
    + `<span class="branch">${escapeHtml(review.branch)}</span></h1>${statusHtml(review, t, offline())}`
    + `<div class="actions">${sourcesToggle(t)}${refresh}${publish}${failure}${artifact}</div></div>`
    + prHeaderHtml(review.pr, t)
    + `<div class="tabs" role="tablist">${tab('story', t.story)}${tab('files', t.files)}</div>`
}

/** The noteKey of the last « here » question if it was about this folder. */
function sentKeyFor(review) {
  const last = state.lastSent
  return last && last.kind === 'here' && last.root === review.root ? last.detail : null
}

function storyHtml(review, t) {
  const toc = review.chapters.map(chapter => {
    const files = new Set(chapter.hunks.map(pathOf)).size
    const i = chapter.intention
    const badge = i ? `<span class="badge" aria-hidden="true">${circled(i.id)}</span>` : '<span class="badge badge-other" aria-hidden="true">·</span>'
    return `<li><a href="#${i ? `chapter-${i.id}` : 'chapter-other'}">${badge}<span class="toc-title">${escapeHtml(i ? i.title : t.otherChanges)}</span>`
      + `<span class="count">${escapeHtml(t.fileCount(files))}</span></a></li>`
  }).join('')
  const summary = review.summary ? `<section class="summary"><p class="summary-label">${escapeHtml(t.summaryLabel)}</p><p>${escapeHtml(review.summary)}</p></section>` : ''
  const sentKey = sentKeyFor(review)
  const chapters = review.chapters.map(chapter => chapterHtml(chapter, review, t, sentKey)).join('')
  // Free questions and answers whose code changed since sit under no code: on top of the story.
  const answers = answersSectionHtml(review.answers.filter(a => a.kind === 'free' || a.moved), t)
  return `${summary}<div class="layout"><aside class="side"><nav class="toc" aria-label="${escapeHtml(t.intentionsLabel)}">`
    + `<p class="side-label">${escapeHtml(t.intentionsLabel)}</p><ol>${toc}</ol></nav>${skippedHtml(review, t)}</aside>`
    + `<div class="content">${answers}${chapters || `<p class="empty">${escapeHtml(t.noChange)}</p>`}</div></div>`
}

function filesHtml(review, t) {
  const chosen = state.selected.get(review.root)
  const file = review.files.find(f => f.path === chosen) ?? review.files[0]
  if (!file) return `<p class="empty">${escapeHtml(t.noChange)}</p>`
  state.selected.set(review.root, file.path)
  const sentKey = sentKeyFor(review)
  const role = file.role ? `<p class="role">${escapeHtml(file.role)}</p>` : ''
  const hunks = file.hunks.length === 0
    ? emptyFileHtml(file, t)
    : file.hunks.map(hunk => `<article class="hunk"><header class="hunk-bar"><code>${escapeHtml(hunk.header)}</code></header>${hunkHtml(hunk, t, sentKey, review.answers)}</article>`).join('')
  // This file's answers whose code changed since, under its hunks.
  const moved = answersSectionHtml(review.answers.filter(a => a.moved && a.path === file.path), t)
  return `<div class="layout"><aside class="side">${treeHtml(review, file.path, t)}</aside>`
    + `<div class="content"><article class="file-view">${fileHeadHtml(file, t)}${role}${hunks}${moved}</article></div></div>`
}

function mainHtml(review, t) {
  if (!state.data) return `<p class="empty empty-page" role="status">${escapeHtml(t.loading)}</p>`
  if (state.preparing !== null) return `<p class="empty empty-page" role="status">${escapeHtml(t.preparing)}</p>`
  if (!review) return `<p class="empty empty-page">${escapeHtml(t.noReview)}</p>`
  const pending = pendingText(review, t)
  if (pending) return `<p class="empty empty-page">${escapeHtml(pending)}</p>`
  return state.tab === 'files' ? filesHtml(drawn(review), t) : storyHtml(drawn(review), t)
}

/** How to find the focused control again once redrawn: a selector, and which of its matches (a hunk can show in two chapters). */
function focusSelector() {
  const el = document.activeElement
  if (!el || el === document.body) return null
  if (el.id) return { selector: `#${CSS.escape(el.id)}`, index: 0 }
  if (!el.dataset.action) return null
  const selector = ['action', 'root', 'path', 'hunk', 'tab'].filter(k => el.dataset[k] !== undefined)
    .map(k => `[data-${k}="${CSS.escape(el.dataset[k])}"]`).join('')
  return { selector, index: [...document.querySelectorAll(selector)].indexOf(el) }
}

/** Redraws what changed, keeping the scroll positions and the focus; the question field is never redrawn. */
function draw() {
  const t = texts()
  const review = currentReview()
  const focus = focusSelector()
  const y = window.scrollY
  const sideScroll = document.querySelector('.side')?.scrollTop ?? 0
  document.documentElement.lang = state.data?.lang === 'en' ? 'en' : 'fr'
  document.title = review ? `${t.title} · ${review.name} · ${review.branch}` : t.title
  const top = topHtml(review, t)
  const main = mainHtml(review, t)
  drawSources(review, t)
  document.body.classList.toggle('offline', offline())
  if (top !== state.drawn.top) $('top').innerHTML = state.drawn.top = top
  if (main !== state.drawn.main) {
    $('main').innerHTML = state.drawn.main = main
    // The standalone copy: the buttons that write are removed, not only hidden.
    if (state.data?.readonly) for (const el of $('main').querySelectorAll('.writes')) el.remove()
    $('main').setAttribute('aria-labelledby', `tab-${state.tab}`)
    jump(y)
    const side = document.querySelector('.side')
    if (side) side.scrollTop = sideScroll
    for (const details of document.querySelectorAll('.skipped')) details.open = state.skippedOpen
  }
  if (focus && (!document.activeElement || document.activeElement === document.body)) {
    const matches = document.querySelectorAll(focus.selector)
    ;(matches[focus.index] ?? matches[0])?.focus({ preventScroll: true })
  }
  drawAsk(review, t)
  drawExplain()
  measure()
}

/** The roots whose « Mettre à jour » was pressed and not answered yet: their rows in the Sources column stay disabled. */
const refreshing = () => new Set([...state.pressed].filter(key => key.startsWith('refresh|')).map(key => key.slice('refresh|'.length)))

/** The Sources column, redrawn only when it changed; folded behind its button on a narrow screen, absent from the published copy. */
function drawSources(review, t) {
  const visible = sourcesVisible()
  const html = visible ? sourcesHtml(state.data.sources, state.want ?? review?.root ?? null, t, refreshing()) : ''
  const column = $('sources')
  column.hidden = !visible
  column.classList.toggle('open', state.sourcesOpen)
  $('shell').classList.toggle('with-sources', visible)
  if (html === state.drawn.sources) return
  const scroll = column.scrollTop
  column.innerHTML = state.drawn.sources = html
  column.scrollTop = scroll
}

/** « Expliquer cette partie » near selected code lines; never in the published copy, nor while the server does not answer. */
function drawExplain() {
  const live = Boolean(state.data) && !state.data.readonly && !offline() && currentReview() !== null
  state.selection = live ? selectedLines(window.getSelection(), SELECTION_CHARS) : null
  $('explain').textContent = texts().explain
  placeButton($('explain'), window.getSelection(), state.selection !== null)
}

function drawAsk(review, t) {
  $('ask').hidden = !review || Boolean(state.data?.readonly)
  if ($('ask').hidden) return // the standalone copy has no question field at all
  const input = $('ask-text')
  const text = input.value.trim()
  const last = state.lastSent
  const sent = last !== null && last.kind === 'free' && last.root === review.root && (text === '' || text === last.detail)
  $('ask-label').textContent = t.askPlaceholder
  input.placeholder = t.askPlaceholder
  $('ask-send').textContent = sent ? t.sent : t.send
  $('ask-send').disabled = sent || text === ''
}

/** The sticky header and footer heights, for the sticky side column and the anchors. */
function measure() {
  const top = $('top')
  const sticky = getComputedStyle(top).position === 'sticky'
  document.documentElement.style.setProperty('--top-h', `${sticky ? top.offsetHeight : 0}px`)
  document.documentElement.style.setProperty('--ask-h', `${$('ask').hidden ? 0 : $('ask').offsetHeight}px`)
}

// -- talking to the server ----------------------------------------------------------

async function post(route, body) {
  try {
    const response = await fetch(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ t: state.token, ...body }),
    })
    return response.ok
  } catch {
    return false
  }
}

/** One press, one send: the same question does not leave again until another one did; a refused send unlocks. */
async function ask(kind, root, detail, body) {
  const key = { kind, root, detail }
  if (sameKey(state.lastSent, key)) return false
  state.lastSent = key
  draw()
  const ok = await post('/ask', { kind, root, ...body })
  if (!ok && sameKey(state.lastSent, key)) {
    state.lastSent = null
    draw()
  }
  return ok
}

/**
 * What « Réessayer » sends again for a failed answer: the same question; null when its change is no longer in the review,
 * or when its selected lines moved (the lines there now are not the ones it asked about).
 */
function retryOf(review, answer) {
  if (answer.kind === 'free') return { detail: answer.question, body: { text: answer.question } }
  const file = review.files.find(f => f.path === answer.path)
  if (!file || !answer.lines || (answer.kind === 'selection' && answer.moved)) return null
  const [from, to] = answer.lines
  if (answer.kind === 'selection') {
    const text = [...linesText(file, from, to)].slice(0, SELECTION_CHARS).join('')
    return { detail: `${file.path}|${from}-${to}`, body: { path: file.path, from, to, text } }
  }
  const note = file.hunks.flatMap(h => h.notes).find(n => n.lines[0] === from && n.lines[1] === to)
  return note ? { detail: noteKey(file.path, note.hunk), body: { path: file.path, hunk: note.hunk, text: '' } } : null
}

/** The review as drawn: a failed answer offers « Réessayer » only when it can be sent again. */
const drawn = review => ({ ...review, answers: review.answers.map(a => (a.status === 'failed' && retryOf(review, a) ? { ...a, retryable: true } : a)) })

/** A failed question may leave again: the page's lock is lifted for it, the mod takes it as it is no longer under way. */
function retry(review, id) {
  const answer = review.answers.find(a => a.id === id && a.status === 'failed')
  const again = answer && retryOf(review, answer)
  if (!again) return
  state.lastSent = null
  void ask(answer.kind, review.root, again.detail, again.body)
}

async function press(action, root) {
  state.pressed.add(`${action}|${root}`)
  draw()
  const ok = await post(`/${action}`, { root })
  if (!ok) {
    state.pressed.delete(`${action}|${root}`)
    draw()
  }
  return ok
}

async function poll() {
  const failures = state.failures
  const wasOffline = offline()
  let changed = false
  try {
    const response = await fetch(url('review.json'), { cache: 'no-store', headers: state.etag ? { 'If-None-Match': state.etag } : {} })
    // 404: the server answers, review.json is not written yet.
    state.failures = [200, 304, 404].includes(response.status) ? 0 : failures + 1
    if (response.status === 200) {
      const data = await response.json()
      state.etag = response.headers.get('ETag')
      state.data = data
      state.pressed.clear()
      changed = true
    }
  } catch {
    // The server may be restarting: the next round tries again.
    state.failures = failures + 1
  }
  if (changed || offline() !== wasOffline) draw()
  setTimeout(poll, POLL_MS)
}

const ping = () => fetch(url('ping'), { cache: 'no-store' }).catch(() => undefined)

// -- interactions ---------------------------------------------------------------------

function showTab(tab) {
  if (tab === state.tab) return
  state.scroll[state.tab] = window.scrollY
  state.tab = tab
  draw()
  jump(state.scroll[tab])
}

/** The address names the chosen source: `#source=<root, encoded>`; a hash that is only an anchor (`#chapter-1`) names none. */
function hashSource() {
  const match = /^#source=(.+)$/.exec(location.hash)
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}

function setHash(root) {
  try {
    history.replaceState(null, '', `#source=${encodeURIComponent(root)}`)
  } catch {
    // an address that cannot change is no reason to refuse the click
  }
}

/**
 * A click on a source chooses its review; one that has none yet, or whose PR has a newer commit, is also refreshed (the mod
 * wakes a sleeping folder, or opens the PR, as for « Mettre à jour »). The review shows as soon as the data holds it.
 */
function chooseSource(root) {
  const missing = !(state.data?.reviews ?? []).some(r => r.root === root)
  const behind = (state.data?.sources ?? []).some(source => source.prs.some(pr => pr.target === root && pr.behind))
  state.want = root
  state.preparing = missing ? root : null
  state.sourcesOpen = false
  setHash(root)
  draw()
  if (!missing && !behind) return
  void press('refresh', root).then(ok => {
    if (ok || state.preparing !== root) return
    state.preparing = null
    draw()
  })
}

/** The address, at load and when it changes by hand, chooses the review without asking for one. */
function applyHash() {
  const root = hashSource()
  if (root === null || root === state.root) return
  state.want = root
  state.preparing = null
  draw()
}

document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]')
  if (!target) return
  const { action, path, hunk, tab, answer, root } = target.dataset
  if (action === 'source') return chooseSource(root)
  if (action === 'sources-toggle') {
    state.sourcesOpen = !state.sourcesOpen
    return draw()
  }
  const review = currentReview()
  if (!review) return
  if (action === 'tab') showTab(tab)
  if (action === 'select') {
    state.selected.set(review.root, path)
    draw()
    document.querySelector('.content')?.scrollIntoView({ block: 'start' })
  }
  if (action === 'here') void ask('here', review.root, noteKey(path, hunk), { path, hunk, text: '' })
  if (action === 'refresh' || action === 'publish') void press(action, review.root)
  if (action === 'retry') retry(review, answer)
})

// The selection is read once per frame; pressing the button must not clear it first.
document.addEventListener('selectionchange', () => requestAnimationFrame(drawExplain))
$('explain').addEventListener('mousedown', event => event.preventDefault())
$('explain').addEventListener('click', () => {
  const review = currentReview()
  const lines = state.selection
  if (!review || !lines) return
  window.getSelection().removeAllRanges()
  void ask('selection', review.root, `${lines.path}|${lines.from}-${lines.to}`, lines)
})

// `toggle` does not bubble: caught on the way down.
document.addEventListener('toggle', event => {
  if (event.target.classList?.contains('skipped')) state.skippedOpen = event.target.open
}, true)

window.addEventListener('hashchange', applyHash)

// As a tab list should: arrows switch tab, Home goes to the first, End to the last.
const TAB_KEYS = { Home: () => 'story', End: () => 'files', ArrowLeft: other => other, ArrowRight: other => other }
document.addEventListener('keydown', event => {
  const next = TAB_KEYS[event.key]
  if (event.target.getAttribute('role') !== 'tab' || !next) return
  event.preventDefault()
  showTab(next(state.tab === 'story' ? 'files' : 'story'))
  $(`tab-${state.tab}`)?.focus()
})

$('ask-text')?.addEventListener('input', () => drawAsk(currentReview(), texts()))
$('ask-form')?.addEventListener('submit', async event => {
  event.preventDefault()
  const review = currentReview()
  const input = $('ask-text')
  const text = input.value.trim()
  if (!review || text === '') return
  if (await ask('free', review.root, text, { text })) {
    if (input.value.trim() === text) input.value = ''
  }
  drawAsk(currentReview(), texts())
})

new ResizeObserver(measure).observe($('top'))

if (inline) {
  state.data = JSON.parse(inline.textContent)
  document.body.classList.toggle('readonly', Boolean(state.data.readonly))
  draw()
} else {
  state.want = hashSource()
  draw()
  void poll()
  void ping()
  setInterval(ping, PING_MS)
  // A hidden tab's timers slow down: say the page is open again as soon as it shows.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void ping()
  })
}
