import { expect, test } from 'claude-code/testing'
import { texts } from '../hooks/i18n'
import type { Change, Review, ReviewFile } from '../hooks/model'
import { freeQuestion, hereKey, hereQuestion, questionKey, selectionKey, selectionQuestion } from '../hooks/questions'

const change: Change = { hunk: '@@ -1,3 +1,4 @@', lines: [12, 18], intention: null, explanation: 'valide la saisie', text: '+check' }
const file: ReviewFile = { path: 'src/form.ts', role: 'Formulaire', importance: 'key', status: 'modified', changes: [change] }
const other: ReviewFile = { path: 'src/api.ts', role: 'Appel', importance: 'normal', status: 'added', changes: [] }
const review: Review = {
  source: { kind: 'conversation', repo: '/repo/app', ref: 'main' },
  diffHash: 'h1',
  summary: 'Résumé',
  intentions: [],
  files: [other, file],
  skipped: [],
  generatedAt: '2026-10-17T10:00:00.000Z',
}

test('hereQuestion in French: the exact template, with the lines of the change', () => {
  expect(hereQuestion(texts('fr'), '/repo/app', file, change)).toBe(
    "Dans `/repo/app/src/form.ts` lignes 12-18 (valide la saisie), que se passe-t-il exactement ? Explique le déroulé, ce qui appelle ce code et ce qu'il appelle.",
  )
})

test('hereQuestion in English: the English template', () => {
  expect(hereQuestion(texts('en'), '/repo/app', file, change)).toBe(
    "In `/repo/app/src/form.ts` lines 12-18 (valide la saisie), what exactly is happening here? Explain the flow, what calls this code and what it calls.",
  )
})

test('hereQuestion joins root and path with exactly one slash', () => {
  expect(hereQuestion(texts('fr'), '/repo/app/', file, change)).toContain('`/repo/app/src/form.ts`')
  expect(hereQuestion(texts('fr'), '/repo/app', { ...file, path: '/src/form.ts' }, change)).toContain('`/repo/app/src/form.ts`')
})

test('freeQuestion in French: the branch, the files in review order, the question', () => {
  expect(freeQuestion(texts('fr'), '/repo/app', review, 'pourquoi ce choix ?')).toBe(
    'À propos des changements de la branche dans `/repo/app` (fichiers : src/api.ts, src/form.ts) : pourquoi ce choix ?',
  )
})

test('freeQuestion in English: the English template', () => {
  expect(freeQuestion(texts('en'), '/repo/app', review, 'why this choice?')).toBe(
    "About the branch's changes in `/repo/app` (files: src/api.ts, src/form.ts): why this choice?",
  )
})

test('freeQuestion trims the edges of the question and keeps the rest as typed', () => {
  expect(freeQuestion(texts('fr'), '/repo/app', review, '  pourquoi  ? \n')).toMatch(/ : pourquoi  \?$/)
})

test('questionKey is stable and differs by kind, folder and detail', () => {
  const key = questionKey('here', '/r', 'a.ts|@@ -1 +1 @@')
  expect(questionKey('here', '/r', 'a.ts|@@ -1 +1 @@')).toBe(key)
  expect(questionKey('here', '/r', 'a.ts|@@ -5 +5 @@')).not.toBe(key)
  expect(questionKey('here', '/other', 'a.ts|@@ -1 +1 @@')).not.toBe(key)
  expect(questionKey('free', '/r', 'a.ts|@@ -1 +1 @@')).not.toBe(key)
})

test('hereKey is the key of a here question', () => {
  expect(hereKey('/r', 'a.ts', '@@ -1 +1 @@')).toBe(questionKey('here', '/r', 'a.ts|@@ -1 +1 @@'))
})

test('selectionQuestion: the exact template, with the folder joined to the path; its key names the lines', () => {
  expect(selectionQuestion(texts('fr'), '/repo/app/', 'src/form.ts', 12, 20)).toBe(
    "Que fait le code de `/repo/app/src/form.ts` lignes 12-20 ? Explique son rôle, ce qui l'appelle et ce qu'il appelle.",
  )
  expect(selectionKey('/r', 'a.ts', 3, 5)).toBe(questionKey('selection', '/r', 'a.ts|3-5'))
  expect(selectionKey('/r', 'a.ts', 3, 6)).not.toBe(selectionKey('/r', 'a.ts', 3, 5))
})
