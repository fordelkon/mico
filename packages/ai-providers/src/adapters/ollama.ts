import type { UIMessageChunk } from 'ai'
import * as z from 'zod'

import type {
  ChatProvider,
  ChatProviderConfiguration,
  ChatProviderDependencies,
  ChatProviderMessage,
  ThinkingSelection
} from '../contracts'
import { parseNdjson } from '../streaming/ndjson'
import { createReasoningChunkEmitter } from '../streaming/parts'
import { createTextChunkEmitter } from '../streaming/text-chunks'
import { getOptimisticThinkingCapabilities } from '../thinking-preferences'

type OllamaConfiguration = Extract<ChatProviderConfiguration, { provider: 'ollama' }>
type OllamaMessage = { role: ChatProviderMessage['role']; content: string; thinking?: string }
type OllamaRequest = {
  model: string
  messages: OllamaMessage[]
  stream: true
  think?: boolean | string
}
const ChunkSchema = z.object({
  message: z.object({ content: z.string().optional(), thinking: z.string().optional() }).optional(),
  done: z.boolean().optional(),
  error: z.string().optional()
})
function getUrl(baseUrl: string): string {
  return new URL('/api/chat', baseUrl).toString()
}
function toMessages(messages: ChatProviderMessage[]) {
  return messages.map((message) => {
    const result: OllamaMessage = {
      role: message.role,
      content: message.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
    }
    const thinking = message.parts
      .filter((part) => part.type === 'reasoning')
      .map((part) => part.text)
      .join('\n')
    if (message.role === 'assistant' && thinking) result.thinking = thinking
    return result
  })
}
function toThink(selection: ThinkingSelection): boolean | string | undefined {
  // Ollama accepts false to disable thinking and uses max for its highest
  // supported level; the other shared preferences are passed through directly.
  if (selection === 'none') return false
  return selection === 'xhigh' ? 'max' : selection
}
function createOllamaProvider(
  configuration: OllamaConfiguration,
  dependencies: ChatProviderDependencies
): ChatProvider {
  return {
    // Ollama does not expose per-model reasoning capabilities, so it follows the
    // same stable, optimistic five-level UI contract as compatible endpoints.
    getModelCapabilities: async () => getOptimisticThinkingCapabilities(),
    stream: async ({ messages, thinkingEffort, signal }) => {
      const think = toThink(thinkingEffort)
      const body: OllamaRequest = {
        model: configuration.modelId,
        messages: toMessages(messages),
        stream: true
      }
      if (think !== undefined) body.think = think
      const response = await dependencies.fetch(getUrl(configuration.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal
      })
      if (!response.ok)
        throw new Error(`Ollama request failed (${response.status} ${response.statusText}).`)
      if (!response.body) throw new Error('Ollama returned an empty streaming response.')
      const stream = response.body
      return (async function* (): AsyncIterable<UIMessageChunk> {
        const text = createTextChunkEmitter(dependencies.createId)
        const reasoning = createReasoningChunkEmitter(dependencies.createId)
        for await (const value of parseNdjson(stream)) {
          const parsed = ChunkSchema.safeParse(value)
          if (!parsed.success)
            throw new Error('The Ollama streaming response contained invalid event data.')
          if (parsed.data.error) throw new Error(parsed.data.error)
          if (parsed.data.message?.thinking)
            yield* reasoning.emitDelta(parsed.data.message.thinking)
          if (parsed.data.message?.content) {
            yield* reasoning.finish()
            yield* text.emitDelta(parsed.data.message.content)
          }
          if (parsed.data.done) break
        }
        yield* reasoning.finish()
        yield* text.finish()
      })()
    }
  }
}
export { createOllamaProvider }
