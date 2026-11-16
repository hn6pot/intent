// Finds the pull requests a conversation talks about, and which of them it opened.
import type { PrRef } from '../model'

/** Compatible with `SessionMessage` of `$.session.messages()`: extra fields are ignored. */
export type ConversationMessage = {
  role: 'user' | 'assistant'
  text: string
  /** `text`: the outcome of the call, as the model read it. */
  toolUses: { tool: string; input?: unknown; text?: string; tool_use_id?: string }[]
  /** Carried by the user message that follows the call, not by the call's own message. */
  toolResults?: { text?: string; tool_use_id?: string }[]
}

// Same expression as the `lighthouse` mod (a mod cannot import another one).
const PR_LINK = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g
const PR_CREATE = /\bgh\s+pr\s+create\b/

/** The PR links of a text, once each, in order of appearance. */
export function prLinks(text: string): PrRef[] {
  const seen = new Map<string, PrRef>()
  for (const match of text.matchAll(PR_LINK)) {
    seen.set(`${match[1]}#${match[2]}`, { slug: match[1], number: Number(match[2]) })
  }
  return [...seen.values()]
}

/** Whether the tool call is a Bash `gh pr create`. */
function createsPr(use: ConversationMessage['toolUses'][number]): boolean {
  if (use.tool !== 'Bash' || typeof use.input !== 'object' || use.input === null) return false
  const { command } = use.input as Record<string, unknown>
  return typeof command === 'string' && PR_CREATE.test(command)
}

/**
 * Every PR the conversation links to, in order of first appearance: the links of the person's messages and of the
 * outputs of Bash calls (not the assistant's text, not what Read, WebFetch or Grep returned).
 * `opened`: the link came out of a Bash `gh pr create` (even if it was seen earlier).
 */
export function conversationPrs(messages: readonly ConversationMessage[]): { ref: PrRef; opened: boolean }[] {
  const found = new Map<string, { ref: PrRef; opened: boolean }>()
  const note = (text: string | undefined, opened: boolean) => {
    for (const ref of prLinks(text ?? '')) {
      const key = `${ref.slug}#${ref.number}`
      const known = found.get(key)
      if (known === undefined) found.set(key, { ref, opened })
      else known.opened ||= opened
    }
  }

  // Opened is decided per call: the outcome sits on the call itself or, in a later user message, on a result with the call's id.
  const creations = new Set<string>()
  const bashCalls = new Set<string>()
  for (const message of messages) {
    if (message.role === 'user') note(message.text, false)
    for (const use of message.toolUses) {
      if (use.tool !== 'Bash') continue
      const creates = createsPr(use)
      if (use.tool_use_id !== undefined) bashCalls.add(use.tool_use_id)
      if (creates && use.tool_use_id !== undefined) creations.add(use.tool_use_id)
      note(use.text, creates)
    }
    for (const result of message.toolResults ?? []) {
      if (result.tool_use_id === undefined || !bashCalls.has(result.tool_use_id)) continue
      note(result.text, creations.has(result.tool_use_id))
    }
  }
  return [...found.values()]
}
