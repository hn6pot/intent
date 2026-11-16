// Self-contained contract (the validator refuses any import): these shapes copy
// Slot and Review from hooks/model.ts, which stays the reference.
export type IntentChange = {
  hunk: string
  lines: [number, number]
  intention: number | null
  explanation: string
  text: string
}

export type IntentFile = {
  path: string
  role: string
  importance: 'key' | 'normal' | 'minor'
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  changes: IntentChange[]
}

export type IntentReview = {
  source: { kind: 'conversation' | 'pr'; repo: string; ref: string }
  diffHash: string
  summary: string
  intentions: { id: number; title: string; why: string; origin: 'conversation' | 'inferred' }[]
  files: IntentFile[]
  skipped: string[]
  generatedAt: string
}

export type IntentSlot = {
  root: string
  name: string
  start: string | null
  preexisting: string[]
  resetStart: boolean
  diffHash: string | null
  review: IntentReview | null
  status: 'idle' | 'running' | 'stale' | 'failed'
  error: 'invalidReply' | 'model' | 'git' | 'truncated' | 'github' | null
  empty: boolean
  gone: boolean
  dormant: string | null
  answers: {
    id: string
    key: string
    kind: 'here' | 'selection' | 'free'
    path?: string
    lines?: [number, number]
    excerpt?: string
    question: string
    answer: string
    status: 'waiting' | 'running' | 'done' | 'failed'
    error: 'interrupted' | 'failed' | null
    at: string
  }[]
  /** A reviewed PR (root `pr:<slug>#<n>`); absent for a folder. */
  pr?: { slug: string; number: number; head: string; clone: string | null; narrow: boolean }
}

/** A PR of the conversation: what gh last said of it, its group (opened or found here, else viewed) and the folder it opens. */
export type IntentKnownPr = {
  ref: { slug: string; number: number }
  /** Opened in this conversation (the output of a `gh pr create`). */
  opened: boolean
  /** Found as the PR of an awake folder's branch. */
  fromBranch: boolean
  /** null: not asked yet, or never reached. */
  info: {
    slug: string
    number: number
    title: string
    state: 'open' | 'merged' | 'closed'
    url: string
    headRefName: string
    headRefOid: string
    baseRefName: string
    baseRefOid: string
  } | null
  /** Last time gh was asked (ms). */
  checkedAt: number | null
  /** The last ask failed. */
  unreachable: boolean
  /** The followed folder whose branch is the PR's head. */
  folder: string | null
}

/** The review page: its address once the server runs, why it cannot run, or null before any try. */
export type IntentPage = { url: string; port: number; token: string } | { error: 'python' | 'start' | 'stopped' } | null

declare module 'claude-code' {
  interface PluginState {
    intent: {
      /** One slot per working folder the session touched. */
      slots: IntentSlot[]
      /** The PRs the conversation links to or opened, and the PR of each awake folder's branch. */
      prs: IntentKnownPr[]
      /** The folder (`root`) whose review the pane shows, else null. */
      selected: string | null
      /** Code blocks unfolded (true) or folded (false) by the person, by change key. */
      expanded: Record<string, boolean>
      /** The pane was closed by hand: the mod never reopens it on its own. */
      paneClosed: boolean
      /** The last question sent (its key), so the same button stays locked until another question goes; null before any. */
      lastSent: string | null
      /** The review page's address and its server's port and token (kept for a reload), or why it cannot run. */
      page: IntentPage
      /** « Ouvrir la revue » waits for the page's server to start and say ready. */
      opening: boolean
      /** The artifact address of each folder (\`root\`) published from the review page. */
      published: Record<string, string>
      /** The branch of each folder (\`root\`) the review page shows, for the pane's folder picker. */
      branches: Record<string, string>
    }
  }
}
