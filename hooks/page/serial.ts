// Runs jobs one at a time; a job asked for during a run replaces any other still waiting, since only the latest data matters.

export type Serial = (job: () => Promise<void>) => Promise<void>

/** Each call resolves once its job ran, or once the job that replaced it did. A failing job never stops the next. */
export function serial(): Serial {
  let running: Promise<void> | null = null
  let waiting: (() => Promise<void>) | null = null
  const loop = async (first: () => Promise<void>) => {
    let job: (() => Promise<void>) | null = first
    while (job) {
      await job().catch(() => undefined)
      job = waiting
      waiting = null
    }
    running = null
  }
  return job => {
    if (running) {
      waiting = job
      return running
    }
    running = loop(job)
    return running
  }
}
