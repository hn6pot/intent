// The only boundary with Claude Code: modules receive a Host, never `$`.
// The Host is built in register.ts: Claude Code refuses `$` crossing an import.

/** `truncated`: stdout was cut (the engine keeps its first 4 MiB). */
export type RunResult = { exitCode: number; stdout: string; stderr: string; truncated?: boolean }
export type RunOptions = { cwd?: string; env?: Record<string, string>; timeoutMs?: number }

export type Store = {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
  keys: () => Promise<string[]>
}

export type Host = {
  run: (argv: readonly string[], options?: RunOptions) => Promise<RunResult>
  now: () => Promise<number>
  store: Store
  home: string
}
