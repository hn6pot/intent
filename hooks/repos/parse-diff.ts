// Turns the text of `git diff` into files and hunks, without any other knowledge of git.
import type { DiffFile, FileStatus, Hunk } from '../model'

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/

/** Path of the "diff --git a/P b/P" line: both halves are equal unless the file moved. */
function pathFromGitLine(rest: string): string {
  const half = (rest.length - 5) / 2
  if (Number.isInteger(half) && half > 0 && rest.slice(2, 2 + half) === rest.slice(5 + half)) return rest.slice(2, 2 + half)
  const cut = rest.lastIndexOf(' b/')
  return cut >= 0 ? rest.slice(cut + 3) : rest
}

/** Path of a "--- a/P" or "+++ b/P" line (git may append a tab after names with spaces). */
function pathFromMarker(value: string): string {
  const name = value.split('\t')[0]
  return name.startsWith('a/') || name.startsWith('b/') ? name.slice(2) : name
}

type Draft = { file: DiffFile; hunkLines: string[] | null }

function closeHunk(draft: Draft): void {
  if (!draft.hunkLines) return
  const header = draft.hunkLines[0]
  const match = HUNK_HEADER.exec(header)!
  const hunk: Hunk = {
    header,
    newStart: Number(match[1]),
    newLines: match[2] === undefined ? 1 : Number(match[2]),
    text: draft.hunkLines.join('\n'),
  }
  draft.file.hunks.push(hunk)
  draft.hunkLines = null
}

function readHeaderLine(file: DiffFile, line: string): void {
  let status: FileStatus | null = null
  if (line.startsWith('new file mode')) status = 'added'
  else if (line.startsWith('deleted file mode')) status = 'deleted'
  else if (line.startsWith('rename from ')) {
    file.oldPath = line.slice('rename from '.length)
    status = 'renamed'
  } else if (line.startsWith('rename to ')) {
    file.path = line.slice('rename to '.length)
    status = 'renamed'
  } else if (line.startsWith('--- ')) {
    if (line.slice(4) === '/dev/null') status = 'added'
    else if (file.status !== 'renamed') file.path = pathFromMarker(line.slice(4))
  } else if (line.startsWith('+++ ')) {
    if (line.slice(4) === '/dev/null') status = 'deleted'
    else if (file.status !== 'renamed') file.path = pathFromMarker(line.slice(4))
  } else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) file.binary = true
  if (status) file.status = status
}

export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let draft: Draft | null = null
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (draft) closeHunk(draft)
      const file: DiffFile = { path: pathFromGitLine(line.slice('diff --git '.length)), status: 'modified', binary: false, hunks: [] }
      files.push(file)
      draft = { file, hunkLines: null }
    } else if (!draft) continue
    else if (line.startsWith('@@')) {
      closeHunk(draft)
      if (HUNK_HEADER.test(line)) draft.hunkLines = [line]
    } else if (draft.hunkLines) draft.hunkLines.push(line)
    else readHeaderLine(draft.file, line)
  }
  if (draft) closeHunk(draft)
  return files
}
