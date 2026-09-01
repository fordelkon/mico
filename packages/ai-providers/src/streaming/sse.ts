type SseEvent = {
  event: string
  data: string
}

function parseFrame(frame: string): SseEvent | null {
  let event = 'message'
  const dataLines: string[] = []

  for (const line of frame.split('\n')) {
    if (!line || line.startsWith(':')) continue

    const separatorIndex = line.indexOf(':')
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex)
    const value = separatorIndex === -1 ? '' : line.slice(separatorIndex + 1).replace(/^ /, '')

    if (field === 'event') event = value
    if (field === 'data') dataLines.push(value)
  }

  // SSE permits multiple data lines in one event; their newline join is part of
  // the wire format, not a JSON formatting choice.
  return dataLines.length > 0 ? { event, data: dataLines.join('\n') } : null
}

async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncIterable<SseEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      // Frames may be split across arbitrary ReadableStream chunks, so consume
      // only complete blank-line-delimited frames.
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const event = parseFrame(frame)
        if (event) yield event
        boundary = buffer.indexOf('\n\n')
      }
    }

    buffer += decoder.decode().replace(/\r\n/g, '\n')
    const event = parseFrame(buffer)
    if (event) yield event
  } finally {
    reader.releaseLock()
  }
}

export { parseSse }
export type { SseEvent }
