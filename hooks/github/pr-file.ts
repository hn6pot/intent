// A file of a PR as the reviewed head has it, read from the local clone.
import type { Host } from '../host'
import type { PrSource } from '../model'

/** The text of `path` at the PR's head (`git show <head>:<path>`); rejects without a clone, or when git has no such file. */
export async function prFile(host: Host, pr: PrSource, path: string): Promise<string> {
  if (pr.clone === null) throw new Error('no clone')
  const r = await host.run(['git', '-C', pr.clone, 'show', `${pr.head}:${path}`])
  if (r.exitCode !== 0) throw new Error(`git show ${pr.head}:${path}`)
  return r.stdout
}
