// The page's address as the mod keeps it, and the port and token to launch the server with.
import { newToken } from './launch'

/** Copied in types/index.d.ts (the contract takes no import). */
export type Page = { url: string; port: number; token: string } | { error: 'python' | 'start' | 'stopped' } | null

export const pageUrl = (port: number, token: string): string => `http://127.0.0.1:${port}/?t=${token}`

/** A page kept from before a module reload: its port and token again, so an open tab finds it back. Else any free port and a new token. */
export function launchKey(kept: Page, random: () => number): { port: number; token: string } {
  return kept !== null && 'token' in kept ? { port: kept.port, token: kept.token } : { port: 0, token: newToken(random) }
}

export const isPageError = (page: Page): boolean => page !== null && 'error' in page
