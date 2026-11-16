// An in-memory Host: canned answers by command pattern.
import type { Host, RunOptions, RunResult } from '../../hooks/host'

export type Answer = Partial<RunResult> | ((argv: readonly string[], options?: RunOptions) => Partial<RunResult>)

export function fakeHost(answers: readonly [RegExp, Answer][], now = 0) {
  const calls: { line: string; options?: RunOptions }[] = []
  const store = new Map<string, unknown>()
  const state = { now }

  const host: Host = {
    run: async (argv, options) => {
      const line = argv.join(' ')
      calls.push({ line, options })
      for (const [pattern, answer] of answers) {
        if (pattern.test(line)) {
          const r = typeof answer === 'function' ? answer(argv, options) : answer
          return { exitCode: 0, stdout: '', stderr: '', ...r }
        }
      }
      return { exitCode: 1, stdout: '', stderr: `no canned answer for: ${line}` }
    },
    now: async () => state.now,
    store: {
      get: async key => store.get(key),
      set: async (key, value) => void store.set(key, value),
      delete: async key => void store.delete(key),
      keys: async () => [...store.keys()],
    },
    home: '/Users/me',
  }

  return { host, calls, store, state }
}
