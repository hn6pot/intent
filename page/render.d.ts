// Types of render.js for the tests (the page itself is plain JavaScript, served as is).
import type { PageAnswer, PageChapter, PageFile, PageHunk, PagePr, PageReview, PageSource } from '../hooks/model'
import type { TEXTS } from './texts.js'

/** The words render.js needs, in the page's language (the full table lives in app.js). */
export type RenderTexts = {
  here: string
  sent: string
  why: string
  conversation: string
  inferred: string
  otherChanges: string
  notExplained: string
  noDiff: string
  binary: string
  key: string
  minor: string
  added: string
  deleted: string
  renamed: string
  answer: {
    waiting: string
    running: string
    added: string
    moved: string
    error: Record<string, string>
    retry: string
    heading: string
  }
}

export function circled(id: number): string
export function noteKey(path: string, hunk: string): string
export function pathOf(hunkId: string): string
export function artifactHref(href: unknown): string | null
export function githubHref(href: unknown): string | null
export function sourcesHtml(sources: PageSource[], currentRoot: string | null, texts: (typeof TEXTS)['fr'], locked?: ReadonlySet<string>): string
export function prHeaderHtml(pr: PagePr | null, texts: (typeof TEXTS)['fr']): string
export function statusHtml(review: PageReview | null, texts: (typeof TEXTS)['fr'], offline: boolean): string
export function pendingText(review: PageReview, texts: (typeof TEXTS)['fr']): string | null
export function highlight(text: string, path: string): string
export function newLines(hunk: PageHunk): (number | null)[]
export function linesText(file: PageFile, from: number, to: number): string
export function hunkHtml(hunk: PageHunk, texts: RenderTexts, sentKey: string | null, answers?: PageAnswer[]): string
export function fileHeadHtml(file: PageFile, texts: RenderTexts, hunkHeader?: string): string
export function emptyFileHtml(file: PageFile, texts: RenderTexts): string
export function chapterHtml(chapter: PageChapter, review: PageReview, texts: RenderTexts, sentKey: string | null): string
export function skippedHtml(review: PageReview, texts: RenderTexts): string
export function treeHtml(review: PageReview, selectedPath: string | null, texts: RenderTexts): string
