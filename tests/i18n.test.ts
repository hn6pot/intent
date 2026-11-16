import { expect, test } from 'claude-code/testing'
import { langOf, texts } from '../hooks/i18n'

/** The shape of a value, recursively: functions compare as 'function', objects by their keys. */
const shape = (value: unknown): unknown =>
  typeof value === 'function'
    ? 'function'
    : typeof value === 'object' && value !== null
      ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]))
      : typeof value

test('langOf: French only when asked, English otherwise', () => {
  expect(langOf('fr')).toBe('fr')
  expect(langOf(undefined)).toBe('en')
  expect(langOf('de')).toBe('en')
})

test('French and English texts have exactly the same keys', () => {
  expect(shape(texts('en'))).toEqual(shape(texts('fr')))
})

test('French wording: pane, header plural, model language', () => {
  const fr = texts('fr')
  expect(fr.paneTitle).toBe('Revue')
  expect(fr.header(1)).toBe('Revue · 1 fichier')
  expect(fr.header(3)).toBe('Revue · 3 fichiers')
  expect(fr.modelLanguage).toBe('French')
})

test('English wording: pane, header plural, model language', () => {
  const en = texts('en')
  expect(en.paneTitle).toBe('Review')
  expect(en.header(1)).toBe('Review · 1 file')
  expect(en.header(3)).toBe('Review · 3 files')
  expect(en.modelLanguage).toBe('English')
})

test('PR wording: the two group headings and the line words, in both languages', () => {
  const [fr, en] = [texts('fr').prs, texts('en').prs]
  expect([fr.heading, fr.viewedHeading, fr.open]).toEqual(['PR de cette conversation', 'PR regardées', 'Ouvrir'])
  expect([fr.state.open, fr.state.merged, fr.state.closed, fr.toReview, fr.unreachable]).toEqual(['ouverte', 'fusionnée', 'fermée', 'à revoir', 'inaccessible'])
  expect([en.heading, en.viewedHeading, en.open]).toEqual(["This conversation's PRs", 'Viewed PRs', 'Open'])
  expect([en.state.open, en.state.merged, en.state.closed, en.toReview, en.unreachable]).toEqual(['open', 'merged', 'closed', 'to review', 'unreachable'])
})
