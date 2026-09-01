type TaggedThinkingDelta = { type: 'text' | 'reasoning'; delta: string }

type TaggedThinkingExtractor = {
  push: (delta: string) => TaggedThinkingDelta[]
  finish: () => TaggedThinkingDelta[]
}
type TaggedThinkingOptions = { startTag?: string; endTag?: string }

function createTaggedThinkingExtractor({
  startTag = '<think>',
  endTag = '</think>'
}: TaggedThinkingOptions = {}): TaggedThinkingExtractor {
  let buffer = ''
  let thinking = false

  const drain = (final: boolean): TaggedThinkingDelta[] => {
    const output: TaggedThinkingDelta[] = []
    while (buffer) {
      const delimiter = thinking ? endTag : startTag
      const index = buffer.indexOf(delimiter)
      if (index >= 0) {
        if (index > 0)
          output.push({ type: thinking ? 'reasoning' : 'text', delta: buffer.slice(0, index) })
        buffer = buffer.slice(index + delimiter.length)
        thinking = !thinking
        continue
      }

      // Hold a partial tag suffix until the next delta: emitting it as text
      // would corrupt tags such as <think> when transport splits mid-tag.
      const retained = final ? 0 : matchingDelimiterPrefixLength(buffer, delimiter)
      const emitLength = buffer.length - retained
      if (emitLength > 0) {
        output.push({ type: thinking ? 'reasoning' : 'text', delta: buffer.slice(0, emitLength) })
        buffer = buffer.slice(emitLength)
      }
      break
    }
    return output
  }

  return {
    push: (delta) => {
      buffer += delta
      return drain(false)
    },
    finish: () => drain(true)
  }
}

function matchingDelimiterPrefixLength(value: string, delimiter: string): number {
  const maximum = Math.min(value.length, delimiter.length - 1)
  for (let length = maximum; length > 0; length -= 1) {
    if (value.endsWith(delimiter.slice(0, length))) return length
  }
  return 0
}

export { createTaggedThinkingExtractor }
export type { TaggedThinkingDelta, TaggedThinkingExtractor }
