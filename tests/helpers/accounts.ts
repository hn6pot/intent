// The lighthouse config a test reads its gh accounts from: the `acme` owner goes through its own gh account.
import type { Answer } from './fake-host'

export const ACME_ACCOUNT = { GH_CONFIG_DIR: '/Users/me/.config/gh-acme' }

export const LIGHTHOUSE_CONFIG: [RegExp, Answer] = [
  /^cat \/Users\/me\/\.lighthouse\/config\.json$/,
  { stdout: JSON.stringify({ ghConfigDirs: { acme: '~/.config/gh-acme' } }) },
]
