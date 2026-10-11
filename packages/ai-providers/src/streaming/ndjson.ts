async function* parseNdjson(stream: ReadableStream<Uint8Array>): AsyncIterable<unknown> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      // A network chunk can end mid-JSON value; keep only the incomplete tail
      // so every yielded line is independently parseable NDJSON.
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim()) yield JSON.parse(line)
      }
    }

    buffer += decoder.decode()
    if (buffer.trim()) yield JSON.parse(buffer)
  } finally {
    // Native completion can stop consumption before EOF; release the connection
    // without allowing cleanup failures to replace the primary result.
    void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export { parseNdjson }
