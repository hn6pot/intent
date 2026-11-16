// The pane's texts and colors, computed without drawing anything.
import type { Texts } from '../i18n'
import type { Answer, Intention, KnownPr, ReviewFile, Slot } from '../model'
import { groupOf, targetOf } from '../prs/known'
import { isDormant, isFolder } from '../review/slots'
import type { Page } from '../server/link'

/** A Claude Code theme key: it follows the light or dark theme. */
export type Color = 'success' | 'warning' | 'error' | 'claude' | 'merged' | 'subtle'
export type Tag = { text: string; color: Color }

const CIRCLED = ['①', '②', '③', '④', '⑤']

/** The circled digit of an intention (the review holds 1 to 5), the plain number past that. */
export const circled = (id: number): string => CIRCLED[id - 1] ?? String(id)

export function statusLine(t: Texts, slot: Slot): { text: string; color: Color } {
  switch (slot.status) {
    // Before the first review the slot is idle too: it waits for the end of the turn.
    case 'idle': return slot.review || slot.empty ? { text: t.status.idle, color: 'success' } : { text: t.status.waiting, color: 'subtle' }
    case 'running': return { text: t.status.running, color: 'claude' }
    case 'stale': return { text: t.status.stale, color: 'warning' }
    case 'failed': return { text: slot.error ? t.failed(t.failure[slot.error]) : t.status.failed, color: 'error' }
  }
}

/** The pane's first line: the file count of the review, the bare title before one or when nothing is left to explain. */
export const headerText = (t: Texts, slot: Slot): string =>
  slot.review && !slot.empty ? t.header(slot.review.files.length) : t.paneTitle

/** What a file's header says about it besides its path: a status word wins over "key", except for a modified key file. */
export function fileTag(t: Texts, file: ReviewFile): Tag | null {
  if (file.status === 'added') return { text: t.added, color: 'success' }
  if (file.status === 'deleted') return { text: t.deleted, color: 'error' }
  if (file.status === 'renamed') return { text: t.renamed, color: 'merged' }
  if (file.importance === 'key') return { text: t.importance.key, color: 'claude' }
  if (file.importance === 'minor') return { text: t.importance.minor, color: 'subtle' }
  return null
}

export function intentionLabel(t: Texts, intention: Intention): string {
  const label = `${circled(intention.id)} ${intention.title}`
  return intention.origin === 'inferred' ? `${label} · ${t.inferred}` : label
}

/** Why the review page cannot run, in one line; null while it runs or before it was tried. */
export const pageNotice = (t: Texts, page: Page): string | null => (page !== null && 'error' in page ? t.page.error[page.error] : null)

/** Characters of the last answer the remote pane shows, on one line. */
const LAST_ANSWER_CHARS = 120
/** Characters of the summary the remote pane shows: about two lines of the side pane. */
const SUMMARY_CHARS = 140

/** A text on one line (its spaces and line breaks made single spaces), cut to `max` characters with « … » past that. */
export function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  const chars = [...line]
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : line
}

/** The summary in the remote pane: two lines or so. */
export const shortSummary = (summary: string): string => clip(summary, SUMMARY_CHARS)

/** How many questions wait or are under way; null when none. */
export function answerCount(t: Texts, answers: readonly Answer[]): string | null {
  const n = answers.filter(a => a.status === 'waiting' || a.status === 'running').length
  return n > 0 ? t.answer.count(n) : null
}

/** The answer that came last (answers keep the asking order, not the arriving one), on one line; null before any. */
export function lastAnswer(answers: readonly Answer[]): string | null {
  // ISO dates compare as text; one done before `doneAt` existed counts as arrived when asked.
  const came = (a: Answer) => a.doneAt ?? a.at
  const last = answers.filter(a => a.status === 'done').reduce<Answer | null>((latest, a) => (latest === null || came(a) >= came(latest) ? a : latest), null)
  return last ? clip(last.answer, LAST_ANSWER_CHARS) : null
}

/** A folder in the picker: its name and its branch, once known. */
export const folderLabel = (name: string, branch: string | undefined): string => (branch ? `${name} · ${branch}` : name)

/** Characters of a PR title in the pane. */
const PR_TITLE_CHARS = 50

/** A PR on one line: `#5 title · open`, `#5 · unreachable` without info; « to review » once it has no review yet. */
export function prLine(pr: KnownPr, reviewed: boolean, t: Texts): string {
  const { info } = pr
  const head = info === null ? `#${pr.ref.number}` : `#${pr.ref.number} ${clip(info.title, PR_TITLE_CHARS)}`
  const state = info === null ? t.prs.unreachable : t.prs.state[info.state]
  return `${head} · ${state}${reviewed ? '' : ` · ${t.prs.toReview}`}`
}

/** The PRs of the pane in their two groups, each with whether a review of it exists. */
export function prGroups(known: readonly KnownPr[], slots: readonly Slot[]): Record<'conversation' | 'viewed', { pr: KnownPr; reviewed: boolean }[]> {
  const awake = new Set(slots.filter(s => isFolder(s) && !isDormant(s)).map(s => s.root))
  const groups: ReturnType<typeof prGroups> = { conversation: [], viewed: [] }
  for (const pr of known) {
    const target = targetOf(pr)
    groups[groupOf(pr, awake)].push({ pr, reviewed: slots.some(s => s.root === target && s.review !== null) })
  }
  return groups
}
