import { expect, test } from 'claude-code/testing'
import { serial } from '../../hooks/page/serial'

/** A job that ends only when the test lets it. */
function held(log: string[], name: string) {
  let end = () => {}
  const job = () => {
    log.push(`start ${name}`)
    return new Promise<void>(resolve => (end = () => (log.push(`end ${name}`), resolve())))
  }
  return { job, end: () => end() }
}
/** Lets the jobs' promise chains run as far as they can. */
const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

test('one job at a time: the next starts once the first ends', async () => {
  const log: string[] = []
  const run = serial()
  const a = held(log, 'a')
  const b = held(log, 'b')
  void run(a.job)
  void run(b.job)
  await tick()
  expect(log).toEqual(['start a'])
  a.end()
  await tick()
  expect(log).toEqual(['start a', 'end a', 'start b'])
  b.end()
})

test('calls made during a run fold into the latest; every caller resolves once it ran', async () => {
  const log: string[] = []
  const run = serial()
  const a = held(log, 'a')
  const b = held(log, 'b')
  const c = held(log, 'c')
  void run(a.job)
  const waitB = run(b.job)
  const waitC = run(c.job)
  await tick()
  a.end()
  await tick()
  c.end()
  await Promise.all([waitB, waitC])
  expect(log).toEqual(['start a', 'end a', 'start c', 'end c'])
})

test('a failing job does not stop the next one', async () => {
  const log: string[] = []
  const run = serial()
  await run(async () => {
    throw new Error('boom')
  })
  await run(async () => void log.push('ran'))
  expect(log).toEqual(['ran'])
})
