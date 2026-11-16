// What a tool call says about the folders the session works in.
import { join, parent } from '../paths'

const FILE_TOOLS: Record<string, string> = { Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' }
const ARG = `("[^"]+"|'[^']+'|[^\\s;&|]+)`
const CD = new RegExp(`(?:^|&&|;|\\|\\||\\()\\s*cd\\s+${ARG}`, 'g')
const GIT_C = new RegExp(`\\bgit\\s+-C\\s+${ARG}`, 'g')

/** A git command that moves the current branch onto another one (its base), options before the subcommand included. */
export const GIT_MOVES_BASE = new RegExp(`\\bgit\\s+(?:(?:-C\\s+${ARG}|-c\\s+\\S+|--no-pager)\\s+)*(?:pull|rebase|merge)(?![-\\w])`)

const unquote = (text: string) => text.replace(/^["']|["']$/g, '')

export function touchedFolders(tool: string, input: Record<string, unknown>, cwd: string, home: string): string[] {
  const key = FILE_TOOLS[tool]
  if (key !== undefined && typeof input[key] === 'string') {
    return [parent(join(cwd, input[key] as string, home))]
  }
  if (tool !== 'Bash' || typeof input.command !== 'string') return []

  const found: string[] = []
  for (const pattern of [CD, GIT_C]) {
    for (const match of input.command.matchAll(pattern)) {
      found.push(join(cwd, unquote(match[1]), home))
    }
  }
  return [...new Set(found)]
}
