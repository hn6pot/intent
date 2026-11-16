// Reads the review server's output for as long as it runs.
import { lineReader, type ServerEvent } from './protocol'

export type ServerOutput = AsyncIterable<{ stream: 'stdout' | 'stderr'; text: string }>

/** Hands over each event of stdout, in order (stderr is left aside); resolves when the server ends, rejects when it fails or cannot start. */
export async function readEvents(output: ServerOutput, onEvent: (event: ServerEvent) => void): Promise<void> {
  const read = lineReader()
  for await (const piece of output) {
    if (piece.stream === 'stdout') for (const event of read(piece.text)) onEvent(event)
  }
}
