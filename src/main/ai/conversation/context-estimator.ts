import type { ChatProviderMessage, ChatProviderTool } from '@mico/ai-providers'
import type { ContextMeasurement } from '@shared/ai/context-measurement'

const MAX_SCHEMA_NODES = 100_000

/** Application projection only: excludes provider framing, metadata and hidden Responses state. */
function estimatePreparedContextTokens(
  messages: readonly ChatProviderMessage[],
  tools: readonly ChatProviderTool[] = []
): ContextMeasurement {
  let estimatedInputTokens = 0
  const count = (text: string): void => {
    let ascii = 0
    let nonAscii = 0
    for (const codepoint of text) {
      if (codepoint.codePointAt(0)! <= 0x7f) ascii += 1
      else nonAscii += 1
    }
    estimatedInputTokens += Math.ceil(ascii / 4 + nonAscii)
  }
  for (const message of messages) {
    count(message.role)
    for (const part of message.parts) {
      if (part.type === 'text' || part.type === 'reasoning') count(part.text)
      else {
        count(part.toolName)
        count(part.type === 'tool-call' ? part.argumentsJson : part.output)
      }
    }
  }
  let schemaTruncated = false
  for (const tool of tools) {
    count(tool.name)
    count(tool.description)
    // Iterative traversal avoids stack overflow and serialization of large schemas.
    // Count JSON keys and scalar values once; cap nodes across each definition.
    const pending: unknown[] = [tool.inputSchema]
    let visited = 0
    while (pending.length && visited < MAX_SCHEMA_NODES) {
      const value = pending.pop()
      visited += 1
      if (!(value instanceof Object)) count(JSON.stringify(value) ?? '')
      else if (Array.isArray(value)) {
        const remaining = MAX_SCHEMA_NODES - visited - pending.length
        if (value.length > remaining) schemaTruncated = true
        pending.push(...value.slice(0, remaining))
      } else {
        const entries = Object.entries(value)
        const remaining = MAX_SCHEMA_NODES - visited - pending.length
        if (entries.length > remaining) schemaTruncated = true
        for (const [key, child] of entries.slice(0, remaining)) {
          count(key)
          pending.push(child)
        }
      }
    }
    schemaTruncated ||= pending.length > 0
  }
  const measurement: ContextMeasurement = { policyId: 'unicode-heuristic-v1', estimatedInputTokens }
  if (schemaTruncated) measurement.schemaTruncated = true
  return measurement
}

export { estimatePreparedContextTokens }
