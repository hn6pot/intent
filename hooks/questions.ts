// The questions the page puts to the model: the wording comes from i18n, the facts from the review.

import type { Texts } from './i18n'
import type { AnswerKind, Change, Review, ReviewFile } from './model'

/** Joins a working folder and a path of the diff with exactly one slash. */
export const joinPath = (root: string, path: string): string => `${root.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`

/**
 * What identifies a question, to tell a repeat from another question: `detail` is `<path>|<hunk>` for `here`,
 * `<path>|<from>-<to>` for `selection`, the cleaned text for `free`.
 */
export const questionKey = (kind: AnswerKind, root: string, detail: string): string => `${kind}|${root}|${detail}`

/** The key of the question about one change. */
export const hereKey = (root: string, path: string, hunk: string): string => questionKey('here', root, `${path}|${hunk}`)

/** The key of the question about selected lines. */
export const selectionKey = (root: string, path: string, from: number, to: number): string => questionKey('selection', root, `${path}|${from}-${to}`)

/** The question asked about one change of one file. */
export const hereQuestion = (t: Texts, root: string, file: ReviewFile, change: Change): string =>
  t.askHere({ path: joinPath(root, file.path), from: change.lines[0], to: change.lines[1], explanation: change.explanation })

/** The question asked about the whole review; the files come in display order. */
export const freeQuestion = (t: Texts, root: string, review: Review, text: string): string =>
  t.askFree({ root, files: review.files.map(file => file.path), question: text.trim() })

/** The question asked about lines selected in one file. */
export const selectionQuestion = (t: Texts, root: string, path: string, from: number, to: number): string =>
  t.askSelection({ path: joinPath(root, path), from, to })
