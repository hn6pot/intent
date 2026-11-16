// Whether someone looks at the review: the pane open, or the page signalling it is open.

/** A page counts as open this long after its last signal (it sends one every 10 s). */
const VIEWER_MS = 25_000

/** Until when a page signal received at `now` counts. */
export const viewerUntil = (now: number): number => now + VIEWER_MS

export const isWatched = (paneClosed: boolean, now: number, until: number): boolean => !paneClosed || now < until
