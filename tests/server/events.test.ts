import { expect, test } from 'claude-code/testing'
import { readEvents } from '../../hooks/server/events'
import type { ServerEvent } from '../../hooks/server/protocol'

type Piece = { stream: 'stdout' | 'stderr'; text: string }
async function* output(pieces: Piece[], fail = false): AsyncGenerator<Piece, { code: number | null; signal: string | null }> {
  for (const piece of pieces) yield piece
  if (fail) throw new Error('cannot start')
  return { code: 0, signal: null }
}

test('the lines of stdout become events, in order; stderr is left aside', async () => {
  const events: ServerEvent[] = []
  await readEvents(
    output([
      { stream: 'stdout', text: '{"type":"ready","port":4312}\n{"type":"vie' },
      { stream: 'stderr', text: '{"type":"refresh","root":"/r"}\n' },
      { stream: 'stdout', text: 'wer"}\n' },
    ]),
    event => events.push(event),
  )
  expect(events).toEqual([{ type: 'ready', port: 4312 }, { type: 'viewer' }])
})

test('a stream that fails rejects: the caller tells the server did not run', async () => {
  await expect(readEvents(output([], true), () => {})).rejects.toThrow('cannot start')
})
