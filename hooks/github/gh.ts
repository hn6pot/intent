// Calling gh with the account that goes with the repo, without touching the active account; and the repo a folder points at.
import type { Host } from '../host'

/**
 * The gh account of a repo's owner, from `ghConfigDirs` in the lighthouse mod's config (`~/.lighthouse/config.json`),
 * so both mods use the same accounts. No file, no entry for the owner, or a bad file: the active account (`undefined`).
 */
export async function ghEnv(host: Host, slug: string): Promise<Record<string, string> | undefined> {
  try {
    const r = await host.run(['cat', `${host.home}/.lighthouse/config.json`])
    if (r.exitCode !== 0) return undefined
    const dirs = (JSON.parse(r.stdout) as { ghConfigDirs?: Record<string, unknown> }).ghConfigDirs
    const dir = dirs?.[slug.split('/')[0]]
    if (typeof dir !== 'string' || dir === '') return undefined
    return { GH_CONFIG_DIR: dir.startsWith('~/') ? `${host.home}${dir.slice(1)}` : dir }
  } catch {
    return undefined
  }
}

/** Runs `gh <args> -R <slug>` and parses its JSON; rejects on a non-zero exit code, bad JSON or the 30 s timeout. */
export async function ghJson<T>(host: Host, slug: string, args: readonly string[]): Promise<T> {
  const r = await host.run(['gh', ...args, '-R', slug], { env: await ghEnv(host, slug), timeoutMs: 30_000 })
  if (r.exitCode !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')} on ${slug}: ${r.stderr.trim()}`)
  return JSON.parse(r.stdout) as T
}

/** 'owner/repo' of a GitHub remote URL (https or ssh); `null` for any other host. */
export function slugFromUrl(url: string): string | null {
  const match = url.trim().match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/)
  return match ? `${match[1]}/${match[2]}` : null
}

/** The GitHub repo `origin` points at in `root`; `null` without an origin, with a non-GitHub one, or when git cannot run. */
export async function originSlug(host: Host, root: string): Promise<string | null> {
  try {
    const r = await host.run(['git', '-C', root, 'remote', 'get-url', 'origin'])
    return r.exitCode === 0 ? slugFromUrl(r.stdout) : null
  } catch {
    return null
  }
}
