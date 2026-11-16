import { expect, test } from 'claude-code/testing'
import { GIT_MOVES_BASE, touchedFolders } from '../../hooks/repos/detect'

const CWD = '/w'
const H = '/h'

test('Edit, Write and NotebookEdit give the file’s folder', () => {
  expect(touchedFolders('Edit', { file_path: 'src/a.ts' }, CWD, H)).toEqual(['/w/src'])
  expect(touchedFolders('Write', { file_path: '/r/x/b.md' }, CWD, H)).toEqual(['/r/x'])
  expect(touchedFolders('NotebookEdit', { notebook_path: '~/n/c.ipynb' }, CWD, H)).toEqual(['/h/n'])
})

test('Bash: cd and git -C, quoted or not', () => {
  const command = 'cd ~/code/notes && git status; git -C "/r/my app" log -1'
  expect(touchedFolders('Bash', { command }, CWD, H)).toEqual(['/h/code/notes', '/r/my app'])
})

test('Bash without cd or git -C: nothing', () => {
  expect(touchedFolders('Bash', { command: 'ls -la' }, CWD, H)).toEqual([])
})

test('an unknown tool: nothing', () => {
  expect(touchedFolders('Read', { file_path: '/r/a' }, CWD, H)).toEqual([])
})

test('GIT_MOVES_BASE: pull, rebase and merge move the branch, status and log do not', () => {
  expect(GIT_MOVES_BASE.test('git pull --ff-only')).toBe(true)
  expect(GIT_MOVES_BASE.test('cd x && git rebase origin/main')).toBe(true)
  expect(GIT_MOVES_BASE.test('git merge origin/main')).toBe(true)
  expect(GIT_MOVES_BASE.test('git status')).toBe(false)
  expect(GIT_MOVES_BASE.test('git log --merges')).toBe(false)
})

test('GIT_MOVES_BASE: options before the subcommand count, merge-base does not', () => {
  expect(GIT_MOVES_BASE.test('git merge-base HEAD origin/main')).toBe(false)
  expect(GIT_MOVES_BASE.test('git -C x pull')).toBe(true)
  expect(GIT_MOVES_BASE.test('git -C "/r/my app" rebase origin/main')).toBe(true)
  expect(GIT_MOVES_BASE.test('git --no-pager merge x')).toBe(true)
  expect(GIT_MOVES_BASE.test('git -c core.editor=true rebase --continue')).toBe(true)
  expect(GIT_MOVES_BASE.test('git pull-request')).toBe(false)
})
