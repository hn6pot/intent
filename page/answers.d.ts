// Types of answers.js for the tests (the page itself is plain JavaScript, served as is).
import type { PageAnswer } from '../hooks/model'
import type { RenderTexts } from './render.js'

export function markdownHtml(text: string): string
/** `retryable`: the page can send a failed answer's question again. */
export type DrawnAnswer = PageAnswer & { retryable?: boolean }

export function answerHtml(answer: DrawnAnswer, texts: Pick<RenderTexts, 'answer'>): string
export function answersSectionHtml(answers: DrawnAnswer[], texts: Pick<RenderTexts, 'answer'>): string
