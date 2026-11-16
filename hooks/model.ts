// Shared types of the review: what the diff holds, what the model explains, what the pane keeps per folder.
import type { Lang } from './i18n'

export type Importance = 'key' | 'normal' | 'minor'
export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed'
/** `header` is the exact "@@ … @@" line. */
export type Hunk = { header: string; newStart: number; newLines: number; text: string }
export type DiffFile = { path: string; oldPath?: string; status: FileStatus; binary: boolean; hunks: Hunk[] }
/** `skipped`: new files left out of the diff (past the cap, or unreadable). */
export type Diff = { files: DiffFile[]; hash: string; chars: number; skipped: string[] }

export type Intention = { id: number; title: string; why: string; origin: 'conversation' | 'inferred' }
/** `text` is the piece of diff, copied by the mod (never by the model). */
export type Change = { hunk: string; lines: [number, number]; intention: number | null; explanation: string; text: string }
export type ReviewFile = { path: string; role: string; importance: Importance; status: FileStatus; changes: Change[] }
export type Review = {
  /** `ref` is the starting point. */
  source: { kind: 'conversation' | 'pr'; repo: string; ref: string }
  diffHash: string
  summary: string
  intentions: Intention[]
  files: ReviewFile[]
  skipped: string[]
  /** ISO date. */
  generatedAt: string
}

/** A pull request on GitHub; `slug` is 'owner/repo'. */
export type PrRef = { slug: string; number: number }

export type PrState = 'open' | 'merged' | 'closed'
/** What `gh pr view` says of a PR: its title, state and the commits its branch and its base point at. */
export type PrInfo = PrRef & {
  title: string
  state: PrState
  url: string
  headRefName: string
  headRefOid: string
  baseRefName: string
  baseRefOid: string
}
/** A PR with what the model reads of it: the description, and the commit messages (headline, then body) in order. */
export type PrDetail = PrInfo & { body: string; commits: string[] }
/** A PR of the session. `folder`: the followed folder (same origin) whose current branch is its head; the PR opens its review. */
export type KnownPr = {
  ref: PrRef
  /** Opened in this conversation (out of a `gh pr create`). */
  opened: boolean
  /** Found as the PR of an awake folder's branch (`branchPr`). */
  fromBranch: boolean
  /** null: not asked yet, or never reached. */
  info: PrInfo | null
  /** Last time gh was asked (ms). */
  checkedAt: number | null
  /** The last ask failed. */
  unreachable: boolean
  folder: string | null
}
/** "This conversation's PRs" or "Viewed PRs". */
export type PrGroup = 'conversation' | 'viewed'
/** What a PR slot reviews: `head` the commit reviewed, `clone` the folder its diff came from, `narrow` a GitHub diff (3 lines of context). */
export type PrSource = PrRef & { head: string; clone: string | null; narrow: boolean }

export type SlotStatus = 'idle' | 'running' | 'stale' | 'failed'
/** Why a pass failed; the pane says it in words. */
export type Failure = 'invalidReply' | 'model' | 'git' | 'truncated' | 'github'
export type Slot = {
  /** Working folder (repo or worktree). */
  root: string
  /** Displayed name: last segment of root. */
  name: string
  /** Starting point (default branch); null before the first change. */
  start: string | null
  /** Untracked files present at the first change. */
  preexisting: string[]
  /** A git pull/rebase/merge just happened on the default branch. */
  resetStart: boolean
  /** Fingerprint of the diff of the last successful generation. */
  diffHash: string | null
  review: Review | null
  status: SlotStatus
  error: Failure | null
  /** The last computed diff held nothing to explain. */
  empty: boolean
  /** The folder no longer exists: the review is frozen. */
  gone: boolean
  /** Only read so far: the diff hash at its first touch; it stays hidden while the diff keeps it. null once awake. */
  dormant: string | null
  /** The answers to the questions asked about this folder's review. */
  answers: Answer[]
  /** A reviewed PR (its root is `pr:<slug>#<n>`); absent for a folder. */
  pr?: PrSource
}

// What the review page reads: the wide-context diff with each explanation attached to the hunk it falls in.
export type PageLine = { kind: 'context' | 'add' | 'del' | 'meta'; old: number | null; new: number | null; text: string }
/** `hunk` is the header of the original 3-line hunk the explanation was written for. */
export type PageNote = { intention: number | null; explanation: string; lines: [number, number]; hunk: string }
/** `id` is `<path>#<n>`, n being the 0-based index of the hunk in its file. */
export type PageHunk = { id: string; header: string; lines: PageLine[]; notes: PageNote[] }
export type PageFile = { path: string; oldPath?: string; status: FileStatus; importance: Importance; role: string; binary: boolean; hunks: PageHunk[] }
/** `intention` null: the "other changes" chapter; `hunks` are PageHunk ids. */
export type PageChapter = { intention: Intention | null; hunks: string[] }
/** The PR a review is of, or the one linked to its folder's branch; `state` null when gh never answered; `narrow`: its diff has 3 lines of context only. */
export type PagePr = { number: number; title: string; state: PrState | null; url: string; narrow: boolean }
export type PageReview = {
  root: string
  name: string
  branch: string
  pr: PagePr | null
  status: SlotStatus
  error: Failure | null
  summary: string
  intentions: Intention[]
  chapters: PageChapter[]
  files: PageFile[]
  skipped: string[]
  answers: PageAnswer[]
}
/**
 * One repo of the Sources column: the awake folders on it (`branches`) and the PRs the session knows of it. `repo` is the slug,
 * or the folder's name when its origin is not on GitHub. `target` is what a click opens: a folder's root or a `pr:` root.
 */
export type PageSource = {
  repo: string
  branches: { root: string; name: string; branch: string }[]
  prs: { number: number; title: string; state: PrState | null; url: string; group: PrGroup; target: string; reviewed: boolean; behind: boolean }[]
}
/**
 * `published`: root folder to the address of its artifact; `publishFailed`: root folder to why its last publish failed.
 * `readonly`: the standalone copy, without the question field and the buttons that write.
 */
export type PageData = {
  lang: Lang
  updatedAt: string
  reviews: PageReview[]
  publish: boolean
  published: Record<string, string>
  publishFailed: Record<string, string>
  sources: PageSource[]
  readonly?: boolean
}

/** What a question is about: a change of the review, selected lines, or the review as a whole. */
export type AnswerKind = 'here' | 'selection' | 'free'
export type AnswerStatus = 'waiting' | 'running' | 'done' | 'failed'
export type Answer = {
  /** `a-<n>`, unique in the session. */
  id: string
  /** The question's key: one press, one send. */
  key: string
  kind: AnswerKind
  /** here, selection. */
  path?: string
  /** here: the lines of the change; selection: the chosen new lines. */
  lines?: [number, number]
  /** The lines sent to the model (4 000 characters at most). */
  excerpt?: string
  /** The question as displayed. */
  question: string
  /** Empty until done. */
  answer: string
  status: AnswerStatus
  error: 'interrupted' | 'failed' | null
  /** failed: why the model gave no answer (an API error and its status, an empty reply, a cut call), when known. */
  reason?: string
  /** ISO date. */
  at: string
  /** ISO date the answer came, once done. */
  doneAt?: string
}
/** What the page reads of an answer; `moved`: its lines no longer sit in any hunk of the file. */
export type PageAnswer = Pick<Answer, 'id' | 'kind' | 'path' | 'lines' | 'question' | 'answer' | 'status' | 'error' | 'reason' | 'at'> & { moved: boolean }
