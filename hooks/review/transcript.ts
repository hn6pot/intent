// Reduces the conversation to a few lines of text: who said what, and which tool touched which file.

/** Compatible with `SessionMessage` of `$.session.messages()`: extra fields (results included) are ignored. */
export type TranscriptMessage = {
  role: 'user' | 'assistant'
  text: string
  toolUses: { tool: string; input?: unknown }[]
}

const SPEAKERS = { user: 'User', assistant: 'Claude' }
const COMMAND_CHARS = 80

/** What a tool call acted on: a file path, or the start of a command. */
function targetOf(input: unknown): string {
  if (typeof input !== 'object' || input === null) return ''
  const { file_path, notebook_path, command } = input as Record<string, unknown>
  if (typeof file_path === 'string') return file_path
  if (typeof notebook_path === 'string') return notebook_path
  if (typeof command === 'string') return command.slice(0, COMMAND_CHARS)
  return ''
}

/**
 * One line per message, then one line per tool call (tool and target, never its output).
 * When the result is longer than `maxChars`, keeps the end, starting at a line boundary.
 */
export function reduceTranscript(messages: readonly TranscriptMessage[], maxChars = 30_000): string {
  const lines: string[] = []
  for (const message of messages) {
    lines.push(`${SPEAKERS[message.role]}: ${message.text.trim()}`.trimEnd())
    for (const { tool, input } of message.toolUses) {
      lines.push(`  [${`${tool} ${targetOf(input)}`.trimEnd()}]`)
    }
  }

  const text = lines.join('\n')
  if (text.length <= maxChars) return text

  const tail = text.slice(text.length - maxChars)
  // The tail starts at a line boundary only when the character just before it is a newline.
  if (text[text.length - maxChars - 1] === '\n') return tail
  const firstBreak = tail.indexOf('\n')
  return firstBreak === -1 ? '' : tail.slice(firstBreak + 1)
}
