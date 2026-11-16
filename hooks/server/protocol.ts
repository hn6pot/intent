// Reads the review server's stdout: one JSON object per line, arriving in chunks of any size.

export type ServerEvent =
  | { type: 'ready'; port: number }
  | { type: 'ask'; kind: 'here' | 'free'; root: string; path?: string; hunk?: string; text?: string }
  | { type: 'ask'; kind: 'selection'; root: string; path: string; from: number; to: number; text: string }
  | { type: 'publish'; root: string }
  | { type: 'refresh'; root: string }
  | { type: 'viewer' }

type Json = Record<string, unknown>

/** Characters of selected lines a selection ask may carry, as the server allows. */
const MAX_SELECTION_CHARS = 4000

/** A reader fed with the output's chunks: each call returns the events of the lines that chunk completes. */
export function lineReader(): (chunk: string) => ServerEvent[] {
  let pending = ''
  return (chunk) => {
    const lines = (pending + chunk).split('\n')
    pending = lines.pop() ?? ''
    const events: ServerEvent[] = []
    for (const line of lines) {
      const event = parseLine(line)
      if (event) events.push(event)
    }
    return events
  }
}

function parseLine(line: string): ServerEvent | null {
  const text = line.endsWith('\r') ? line.slice(0, -1) : line
  if (text.trim() === '') return null
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  return isRecord(value) ? toEvent(value) : null
}

function toEvent(value: Json): ServerEvent | null {
  switch (value.type) {
    case 'ready': return isPort(value.port) ? { type: 'ready', port: value.port } : null
    case 'ask': return toAsk(value)
    case 'publish': return nonEmpty(value.root) ? { type: 'publish', root: value.root } : null
    case 'refresh': return nonEmpty(value.root) ? { type: 'refresh', root: value.root } : null
    case 'viewer': return { type: 'viewer' }
    default: return null
  }
}

/** Selected lines of one file: `1 <= from <= to`, their text 4 000 characters at most. */
function toSelection(value: Json): ServerEvent | null {
  const { root, path, from, to, text } = value
  if (!nonEmpty(root) || !nonEmpty(path) || !isLine(from) || !isLine(to) || from > to) return null
  if (typeof text !== 'string' || [...text].length > MAX_SELECTION_CHARS) return null // code points, as Python counts
  return { type: 'ask', kind: 'selection', root, path, from, to, text }
}

/** `here` needs a path and a hunk, `free` needs a text. Absent fields (null included) are left out of the event. */
function toAsk(value: Json): ServerEvent | null {
  const { kind, root, path, hunk, text } = value
  if (kind === 'selection') return toSelection(value)
  if (!nonEmpty(root) || !isOptional(path) || !isOptional(hunk) || !isOptional(text)) return null
  const present = {
    ...(typeof path === 'string' ? { path } : {}),
    ...(typeof hunk === 'string' ? { hunk } : {}),
    ...(typeof text === 'string' ? { text } : {}),
  }
  if (kind === 'here' && typeof path === 'string' && typeof hunk === 'string') return { type: 'ask', kind, root, ...present }
  if (kind === 'free' && typeof text === 'string') return { type: 'ask', kind, root, ...present }
  return null
}

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const isPort = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0
const isLine = isPort
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value !== ''
const isOptional = (value: unknown): boolean => value === undefined || value === null || typeof value === 'string'
