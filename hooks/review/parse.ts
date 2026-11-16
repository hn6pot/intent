// Turns the model reply into a Review: extracts the JSON, then keeps only what the diff can back up.
import type { Change, DiffFile, Hunk, Importance, Intention, Review, ReviewFile } from '../model'

type Meta = {
  repo: string
  ref: string
  diffHash: string
  skipped: string[]
  now: number
  /** Default 'conversation'. */
  kind?: 'conversation' | 'pr'
  /** Default false. True: the mod forces every intention to "inferred" (a review not of this conversation), whatever the model said. */
  inferredOnly?: boolean
}
type Json = Record<string, unknown>

const MAX_INTENTIONS = 5
const IMPORTANCE_ORDER: Importance[] = ['key', 'normal', 'minor']

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const isString = (value: unknown): value is string => typeof value === 'string'
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/** The whole text, else a json block, else from the first "{" to the last "}". */
function extractJson(reply: string): { value: unknown } | null {
  const candidates = [reply]
  const block = /```json\s*([\s\S]*?)```/i.exec(reply)
  if (block) candidates.push(block[1])
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start !== -1 && end > start) candidates.push(reply.slice(start, end + 1))
  for (const candidate of candidates) {
    try {
      return { value: JSON.parse(candidate) }
    } catch {
      // try the next candidate
    }
  }
  return null
}

function readIntentions(raw: unknown): Intention[] {
  const intentions: Intention[] = []
  for (const item of asArray(raw)) {
    if (!isObject(item) || !Number.isInteger(item.id) || !isString(item.title) || !isString(item.why)) continue
    intentions.push({ id: item.id as number, title: item.title, why: item.why, origin: item.origin === 'conversation' ? 'conversation' : 'inferred' })
    if (intentions.length === MAX_INTENTIONS) break
  }
  return intentions
}

/** The intentions, every origin forced to "inferred": what the mod says of a review that is not of this conversation. */
export const asInferred = (intentions: readonly Intention[]): Intention[] => intentions.map(intention => ({ ...intention, origin: 'inferred' }))

const isTwoIntegers = (value: unknown): value is [number, number] =>
  Array.isArray(value) && value.length === 2 && Number.isInteger(value[0]) && Number.isInteger(value[1])

const hunkLines = (hunk: Hunk): [number, number] => [hunk.newStart, hunk.newStart + Math.max(hunk.newLines, 1) - 1]

function readChange(raw: unknown, source: DiffFile, intentionIds: Set<number>): Change | null {
  if (!isObject(raw) || !isString(raw.hunk) || !isString(raw.explanation)) return null
  const header = raw.hunk.trim()
  const hunk = source.hunks.find(candidate => candidate.header.trim() === header)
  if (!hunk) return null
  return {
    hunk: hunk.header,
    lines: isTwoIntegers(raw.lines) ? raw.lines : hunkLines(hunk),
    intention: typeof raw.intention === 'number' && intentionIds.has(raw.intention) ? raw.intention : null,
    explanation: raw.explanation,
    text: hunk.text,
  }
}

function readFile(raw: unknown, diff: readonly DiffFile[], intentionIds: Set<number>): ReviewFile | null {
  if (!isObject(raw)) return null
  const source = diff.find(candidate => candidate.path === raw.path)
  if (!source) return null
  const importance = IMPORTANCE_ORDER.find(level => level === raw.importance) ?? 'normal'
  const changes = importance === 'minor' ? [] : asArray(raw.changes).flatMap(item => readChange(item, source, intentionIds) ?? [])
  return { path: source.path, role: isString(raw.role) ? raw.role : '', importance, status: source.status, changes }
}

export function parseReview(reply: string, files: readonly DiffFile[], meta: Meta): Review | { error: string } {
  const extracted = extractJson(reply)
  if (!extracted) return { error: 'invalid JSON' }
  const data = extracted.value
  if (!isObject(data) || !isString(data.summary) || data.summary.trim() === '' || !Array.isArray(data.files)) {
    return { error: 'missing summary or files' }
  }
  const read = readIntentions(data.intentions)
  const intentions = meta.inferredOnly ?? false ? asInferred(read) : read
  const intentionIds = new Set(intentions.map(intention => intention.id))
  const reviewFiles = data.files.flatMap(item => readFile(item, files, intentionIds) ?? [])
  // A file the model left out is listed all the same: the reader must see every place the branch touches.
  const listed = new Set(reviewFiles.map(file => file.path))
  for (const file of files) {
    if (listed.has(file.path) || meta.skipped.includes(file.path)) continue
    reviewFiles.push({ path: file.path, role: '', importance: 'normal', status: file.status, changes: [] })
  }
  // Array.prototype.sort is stable: the reply order is kept inside a group.
  reviewFiles.sort((a, b) => IMPORTANCE_ORDER.indexOf(a.importance) - IMPORTANCE_ORDER.indexOf(b.importance))
  return {
    source: { kind: meta.kind ?? 'conversation', repo: meta.repo, ref: meta.ref },
    diffHash: meta.diffHash,
    summary: data.summary,
    intentions,
    files: reviewFiles,
    skipped: meta.skipped,
    generatedAt: new Date(meta.now).toISOString(),
  }
}
