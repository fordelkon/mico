import { describe, expect, it } from 'vitest'

import { parseSse } from '../streaming/sse'

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    }
  })
}

describe('parseSse', () => {
  it('parses named events split across chunks and joins multi-line data', async () => {
    const events = []
    for await (const event of parseSse(
      streamFrom([
        'event: message.delta\ndata: {"delta":"Hel',
        'lo"}\ndata: \n\n: keep-alive\n\nevent: chat.end\ndata: {}\n\n'
      ])
    )) {
      events.push(event)
    }

    expect(events).toEqual([
      { event: 'message.delta', data: '{"delta":"Hello"}\n' },
      { event: 'chat.end', data: '{}' }
    ])
  })
})
