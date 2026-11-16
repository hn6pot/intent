// Where an answer sits on the page: by file and lines, like the notes of the review; lines no hunk holds any more mean "moved".
import type { Answer, PageAnswer, PageReview } from '../model'
import { covers } from '../page/data'

const NEW_RANGE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/

/** The new-side range of a page hunk, from its header; a missing count is 1. */
function newRange(header: string): { newStart: number; newLines: number } | null {
  const match = NEW_RANGE.exec(header)
  return match ? { newStart: Number(match[1]), newLines: match[2] === undefined ? 1 : Number(match[2]) } : null
}

function moved(answer: Answer, review: PageReview): boolean {
  if (answer.kind === 'free' || answer.path === undefined || answer.lines === undefined) return false
  const lines = answer.lines
  const file = review.files.find(f => f.path === answer.path)
  return !file?.hunks.some(hunk => {
    const range = newRange(hunk.header)
    return range !== null && covers(range, lines)
  })
}

/** What the page reads of each answer, in order; `moved` when its lines no longer fall in any hunk of its file. */
export function pageAnswers(answers: readonly Answer[], review: PageReview): PageAnswer[] {
  return answers.map(a => {
    const page: PageAnswer = { id: a.id, kind: a.kind, question: a.question, answer: a.answer, status: a.status, error: a.error, at: a.at, moved: moved(a, review) }
    if (a.path !== undefined) page.path = a.path
    if (a.lines !== undefined) page.lines = a.lines
    if (a.reason !== undefined) page.reason = a.reason
    return page
  })
}
