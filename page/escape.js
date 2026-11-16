// Escaping for the page's HTML strings, the one place it is written. Imports nothing.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ESCAPES[c])
