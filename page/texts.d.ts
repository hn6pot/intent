// Types of texts.js for the tests (the page itself is plain JavaScript, served as is).
import type { Failure } from '../hooks/model'
type PageTexts = {
  [key: string]: unknown
  status: Record<string, string>
  failed: (reason: string) => string
  failure: Record<Failure, string>
  offline: string
  preparing: string
  notYet: string
  explain: string
  sources: string
  branchHere: string
  conversationPrs: string
  viewedPrs: string
  prState: Record<'open' | 'merged' | 'closed' | 'null', string>
  prToReview: string
  prBehind: string
  openOnGitHub: string
  narrowDiff: string
  answer: { waiting: string; running: string; added: string; moved: string; error: Record<string, string>; retry: string; heading: string }
}

export const TEXTS: { fr: PageTexts; en: PageTexts }
