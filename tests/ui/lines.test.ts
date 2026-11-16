import { expect, test } from 'claude-code/testing'
import { texts } from '../../hooks/i18n'
import type { Answer, Intention, KnownPr, ReviewFile, Slot } from '../../hooks/model'
import { answerCount, clip, shortSummary, fileTag, folderLabel, headerText, intentionLabel, lastAnswer, pageNotice, prGroups, prLine, statusLine } from '../../hooks/ui/lines'

const t = texts('fr')
const SLOT: Slot = {
  root: '/r', name: 'r', start: 'main', preexisting: [], resetStart: false,
  diffHash: null, review: null, status: 'idle', error: null, empty: false, gone: false, dormant: null, answers: [],
}
const FILE: ReviewFile = { path: 'a.ts', role: 'role', importance: 'normal', status: 'modified', changes: [] }
const INTENTION: Intention = { id: 3, title: 'Titre', why: 'parce que', origin: 'conversation' }

const REVIEW = {
  source: { kind: 'conversation', repo: '/r', ref: 'main' }, diffHash: 'h', summary: 's', intentions: [],
  files: [FILE, FILE], skipped: [], generatedAt: '2026-10-17T10:00:00.000Z',
} as const satisfies Slot['review']

test('status line: one text and color per status', () => {
  expect(statusLine(t, { ...SLOT, review: REVIEW })).toEqual({ text: 'à jour', color: 'success' })
  expect(statusLine(t, { ...SLOT, status: 'running' })).toEqual({ text: '⟳ mise à jour…', color: 'claude' })
  expect(statusLine(t, { ...SLOT, status: 'stale' })).toEqual({ text: 'en retard', color: 'warning' })
  expect(statusLine(t, { ...SLOT, status: 'failed', error: 'model' })).toEqual({ text: "échec : le modèle n'a pas répondu", color: 'error' })
})

test('status line: a failure without message keeps the bare word', () => {
  expect(statusLine(t, { ...SLOT, status: 'failed' })).toEqual({ text: 'échec', color: 'error' })
})

test('status line follows the language', () => {
  expect(statusLine(texts('en'), { ...SLOT, review: REVIEW }).text).toBe('up to date')
})

test('status line: each failure reason in words, with the separator of the language', () => {
  const failed = (error: Slot['error']): Slot => ({ ...SLOT, status: 'failed', error })
  expect(statusLine(t, failed('invalidReply')).text).toBe('échec : réponse du modèle illisible')
  expect(statusLine(t, failed('git')).text).toBe('échec : commande git en échec')
  expect(statusLine(t, failed('truncated')).text).toBe('échec : diff trop gros pour être lu')
  expect(statusLine(texts('en'), failed('model')).text).toBe('failed: the model did not answer')
  expect(statusLine(texts('en'), failed('invalidReply')).text).toBe('failed: unreadable model reply')
})

test('status line: waiting before any review, up to date once there is nothing to explain', () => {
  expect(statusLine(t, SLOT)).toEqual({ text: 'en attente', color: 'subtle' })
  expect(statusLine(texts('en'), SLOT).text).toBe('waiting')
  expect(statusLine(t, { ...SLOT, empty: true }).text).toBe('à jour')
})

test('header: the file count of the review, the bare title before any review or when there is nothing to explain', () => {
  expect(headerText(t, { ...SLOT, review: REVIEW })).toBe('Revue · 2 fichiers')
  expect(headerText(t, SLOT)).toBe('Revue')
  expect(headerText(t, { ...SLOT, review: REVIEW, empty: true })).toBe('Revue')
})

test('file tag: key, new, deleted, renamed, minor, nothing', () => {
  expect(fileTag(t, { ...FILE, importance: 'key' })?.text).toBe('clé')
  expect(fileTag(t, { ...FILE, status: 'added' })?.text).toBe('nouveau')
  expect(fileTag(t, { ...FILE, status: 'deleted' })?.text).toBe('supprimé')
  expect(fileTag(t, { ...FILE, status: 'renamed' })?.text).toBe('renommé')
  expect(fileTag(t, { ...FILE, importance: 'minor' })).toEqual({ text: 'mineur', color: 'subtle' })
  expect(fileTag(t, FILE)).toBeNull()
})

test('file tag: the status word wins over key', () => {
  expect(fileTag(t, { ...FILE, importance: 'key', status: 'added' })?.text).toBe('nouveau')
  expect(fileTag(t, { ...FILE, importance: 'key', status: 'renamed' })?.text).toBe('renommé')
})

test('intention label: circled number, title, inferred mark', () => {
  expect(intentionLabel(t, INTENTION)).toBe('③ Titre')
  expect(intentionLabel(t, { ...INTENTION, id: 1, origin: 'inferred' })).toBe('① Titre · déduite')
  expect(intentionLabel(texts('en'), { ...INTENTION, id: 5, origin: 'inferred' })).toBe('⑤ Titre · inferred')
})

test('page notice: why the page cannot run, nothing while it runs or before it was tried', () => {
  expect(pageNotice(t, { error: 'python' })).toBe('Page de revue indisponible : python3 introuvable sur ce Mac.')
  expect(pageNotice(t, { error: 'start' })).toBe("Page de revue indisponible : son serveur n'a pas démarré.")
  expect(pageNotice(texts('en'), { error: 'start' })).toBe('Review page unavailable: its server did not start.')
  expect(pageNotice(t, { error: 'stopped' })).toBe("Page de revue indisponible : son serveur s'est arrêté.")
  expect(pageNotice(texts('en'), { error: 'stopped' })).toBe('Review page unavailable: its server stopped.')
  expect(pageNotice(t, { url: 'http://127.0.0.1:1/?t=x', port: 1, token: 'x' })).toBeNull()
  expect(pageNotice(t, null)).toBeNull()
})

test('remote wording: the open buttons, the publish failure, the consent and the artifact description', () => {
  expect(t.button.openReview).toBe('Ouvrir la revue')
  expect(texts('en').button.openReview).toBe('Open the review')
  expect(t.button.openArtifact).toBe("Voir l'artefact ↗")
  expect(t.page.publishFailed(t.page.publishReason.denied)).toBe('Publication impossible (annulée)')
  expect(texts('en').page.publishFailed(texts('en').page.publishReason.refused)).toBe('Could not publish (refused)')
  expect(t.page.publishConsent).toBe("J'ai appuyé sur Publier dans la page de revue")
  expect(texts('en').page.publishConsent).toBe('I pressed Publish on the review page')
  expect(t.page.publishDescription('app', 'feat/x')).toBe('Revue des changements de app sur la branche feat/x')
  expect(texts('en').page.publishDescription('app', 'feat/x')).toBe('Review of the changes in app on branch feat/x')
})

const ANSWER: Answer = {
  id: 'a-1', key: 'k', kind: 'free', question: 'q', answer: '', status: 'running', error: null, at: '2026-10-19T10:00:00.000Z',
}

test('answer count: the questions waiting or under way, singular and plural; nothing when none', () => {
  expect(answerCount(t, [ANSWER])).toBe('1 question en cours')
  expect(answerCount(t, [ANSWER, { ...ANSWER, status: 'waiting' }, { ...ANSWER, status: 'done' }])).toBe('2 questions en cours')
  expect(answerCount(texts('en'), [ANSWER, ANSWER])).toBe('2 questions under way')
  expect(answerCount(texts('en'), [ANSWER])).toBe('1 question under way')
  expect(answerCount(t, [{ ...ANSWER, status: 'failed' }])).toBeNull()
})

test('last answer: the last one done, on one line, cut at 120 characters', () => {
  const done = (answer: string) => ({ ...ANSWER, status: 'done' as const, answer })
  expect(lastAnswer([done('premier'), done('Deux\n\n- lignes  ici'), ANSWER])).toBe('Deux - lignes ici')
  const long = lastAnswer([done('x'.repeat(200))])!
  expect([...long]).toHaveLength(120)
  expect(long.endsWith('…')).toBe(true)
  expect(lastAnswer([ANSWER])).toBeNull()
})

test('last answer: the one that arrived last, not the one asked last', () => {
  const done = (answer: string, doneAt: string) => ({ ...ANSWER, status: 'done' as const, answer, doneAt })
  expect(lastAnswer([done('lent', '2026-10-19T10:05:00.000Z'), done('rapide', '2026-10-19T10:01:00.000Z')])).toBe('lent')
})

test('clip: a text past its length cut with « … », a short one untouched', () => {
  expect(clip('abcdef', 4)).toBe('abc…')
  expect(clip('abc', 4)).toBe('abc')
  expect(clip('  a\n b ', 10)).toBe('a b')
})

test('short summary: about two lines of the pane, cut with « … »', () => {
  expect(shortSummary('Court.')).toBe('Court.')
  expect([...shortSummary('m '.repeat(200))]).toHaveLength(140)
})

test('folder label: the folder and its branch, the folder alone while its branch is unknown', () => {
  expect(folderLabel('app', 'feat/x')).toBe('app · feat/x')
  expect(folderLabel('app', undefined)).toBe('app')
})

test('compact remote wording: the file count that points to the review', () => {
  expect(t.filesInPage(98)).toBe('98 fichiers · voir dans la revue')
  expect(t.filesInPage(1)).toBe('1 fichier · voir dans la revue')
  expect(texts('en').filesInPage(2)).toBe('2 files · see them in the review')
})

const PR: KnownPr = {
  ref: { slug: 'a/b', number: 5 }, opened: false, fromBranch: false, checkedAt: 1, unreachable: false, folder: null,
  info: { slug: 'a/b', number: 5, title: 'Add the thing', state: 'open', url: 'u', headRefName: 'h', headRefOid: 'o', baseRefName: 'main', baseRefOid: 'm' },
}

test('PR line: number, title and state; « à revoir » without a review', () => {
  expect(prLine(PR, true, t)).toBe('#5 Add the thing · ouverte')
  expect(prLine(PR, false, t)).toBe('#5 Add the thing · ouverte · à revoir')
  expect(prLine({ ...PR, info: { ...PR.info!, state: 'merged' } }, true, t)).toBe('#5 Add the thing · fusionnée')
  expect(prLine({ ...PR, info: { ...PR.info!, state: 'closed' } }, true, t)).toBe('#5 Add the thing · fermée')
})

test('PR line: a title past 50 characters is cut, a PR without info is unreachable', () => {
  const long = prLine({ ...PR, info: { ...PR.info!, title: 'x'.repeat(80) } }, true, t)
  expect(long).toBe(`#5 ${'x'.repeat(49)}… · ouverte`)
  expect(prLine({ ...PR, info: null, unreachable: true }, true, t)).toBe('#5 · inaccessible')
  expect(prLine({ ...PR, info: null }, false, t)).toBe('#5 · inaccessible · à revoir')
})

test('PR line follows the language', () => {
  const en = texts('en')
  expect(prLine(PR, false, en)).toBe('#5 Add the thing · open · to review')
  expect(prLine({ ...PR, info: null }, true, en)).toBe('#5 · unreachable')
})

test('PR groups: this conversation\'s and the viewed ones, each with whether it has a review; a PR of an awake folder is the conversation\'s', () => {
  const opened: KnownPr = { ...PR, ref: { slug: 'a/b', number: 6 }, opened: true }
  const linked: KnownPr = { ...PR, ref: { slug: 'a/b', number: 7 }, folder: '/r' }
  const asleep: KnownPr = { ...PR, ref: { slug: 'a/b', number: 8 }, folder: '/s' }
  const slots: Slot[] = [{ ...SLOT, review: REVIEW }, { ...SLOT, root: '/s', dormant: 'h' }, { ...SLOT, root: 'pr:a/b#5', review: REVIEW }]
  expect(prGroups([PR, opened, linked, asleep], slots)).toEqual({
    conversation: [{ pr: opened, reviewed: false }, { pr: linked, reviewed: true }],
    viewed: [{ pr: PR, reviewed: true }, { pr: asleep, reviewed: false }],
  })
  expect(prGroups([], slots)).toEqual({ conversation: [], viewed: [] })
})
