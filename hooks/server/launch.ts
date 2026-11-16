// How the review server is started and where its session files live. No `$` here: the Host and the write function come from register.ts.
import type { Host } from '../host'

const PYTHON_CHECK = 'import sys; print(sys.version_info >= (3, 7))'

/** The folder of one session's files: `<home>/.claude-mods/intent/<id>`. */
export function sessionDir(home: string, sessionId: string): string {
  return `${home}/.claude-mods/intent/${sessionId}`
}

/** 32 lowercase hexadecimal characters, one per injected random value in [0, 1). */
export function newToken(random: () => number): string {
  let token = ''
  for (let i = 0; i < 32; i++) token += Math.floor(random() * 16).toString(16)
  return token
}

/** The command that runs the server: its folder, its page folder, its token and its port. */
export function serverArgv(python: string, pluginRoot: string, dir: string, token: string, port: number): string[] {
  return [python, `${pluginRoot}/server/serve.py`, '--dir', dir, '--page', `${pluginRoot}/page`, '--token', token, '--port', String(port)]
}

/** `/usr/bin/python3` when it is 3.7 or later, else the `python3` of the PATH, else null. */
export async function findPython(host: Host): Promise<string | null> {
  for (const python of ['/usr/bin/python3', 'python3']) {
    if (await answersTrue(host, python)) return python
  }
  return null
}

async function answersTrue(host: Host, python: string): Promise<boolean> {
  try {
    const r = await host.run([python, '-c', PYTHON_CHECK])
    return r.exitCode === 0 && r.stdout.trim() === 'True'
  } catch {
    return false
  }
}

/** Writes `value` as JSON to a temporary file beside `path`, then moves it over `path`: a reader never sees half a file. */
export async function writeJson(
  host: Host,
  write: (path: string, text: string) => Promise<void>,
  path: string,
  value: unknown,
): Promise<void> {
  const tmp = `${path}.tmp-${await host.now()}`
  await write(tmp, JSON.stringify(value))
  const moved = await host.run(['mv', '-f', tmp, path])
  if (moved.exitCode !== 0) throw new Error(`cannot write ${path}: ${moved.stderr.trim()}`)
}

/** Removes the session folders untouched for 30 days. Failures are ignored: the folder may not exist yet. */
export async function cleanOld(host: Host, home: string, now: number): Promise<void> {
  try {
    await host.run([
      'find', `${home}/.claude-mods/intent`, '-mindepth', '1', '-maxdepth', '1', '-type', 'd',
      '-mtime', '+30', '-exec', 'rm', '-rf', '{}', '+',
    ])
  } catch {
    // Nothing to clean, or no find: the next session start tries again.
  }
}
