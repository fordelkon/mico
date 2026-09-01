import type { UIMessageChunk } from 'ai'
import * as z from 'zod'

import type {
  ChatProvider,
  ChatProviderConfiguration,
  ChatProviderDependencies,
  ChatProviderMessage
} from '../contracts'
import { createReasoningChunkEmitter } from '../streaming/parts'
import { parseSse } from '../streaming/sse'
import { createTaggedThinkingExtractor } from '../streaming/tagged-thinking'
import { createTextChunkEmitter } from '../streaming/text-chunks'
import { createThinkingFallback, getOptimisticThinkingCapabilities } from '../thinking-preferences'

type OpenAICompatibleConfiguration = Extract<
  ChatProviderConfiguration,
  { provider: 'openai-compatible' }
>
type OpenAICompatibleHeaders = { 'content-type': string; authorization?: string }
const EventSchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: z.string().optional(),
            reasoning: z.string().optional(),
            reasoning_content: z.string().optional(),
            reasoning_text: z.string().optional()
          })
          .optional()
      })
    )
    .optional(),
  error: z.object({ message: z.string().optional() }).optional()
})

function getUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  const path = url.pathname.replace(/\/+$/, '')
  // A versioned base URL owns its version; otherwise preserve the OpenAI /v1 default.
  url.pathname = path.endsWith('/chat/completions')
    ? path
    : /\/v\d+$/.test(path)
      ? `${path}/chat/completions`
      : `${path}/v1/chat/completions`
  return url.toString()
}
function toMessages(messages: ChatProviderMessage[]) {
  return messages.flatMap((message) => {
    const content = message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
    return content ? [{ role: message.role, content }] : []
  })
}
function createOpenAICompatibleProvider(
  configuration: OpenAICompatibleConfiguration,
  dependencies: ChatProviderDependencies
): ChatProvider {
  const fetchWithThinkingFallback = createThinkingFallback()
  return {
    getModelCapabilities: async () => getOptimisticThinkingCapabilities(),
    stream: async ({ messages, thinkingEffort, signal }) => {
      const headers: OpenAICompatibleHeaders = { 'content-type': 'application/json' }
      if (configuration.apiKey) headers.authorization = `Bearer ${configuration.apiKey}`
      const request = {
        model: configuration.modelId,
        messages: toMessages(messages),
        stream: true
      }
      const response = await fetchWithThinkingFallback(thinkingEffort, (includeThinking) =>
        dependencies.fetch(getUrl(configuration.baseUrl), {
          method: 'POST',
          headers,
          body: JSON.stringify(
            includeThinking ? { ...request, reasoning_effort: thinkingEffort } : request
          ),
          signal
        })
      )
      if (!response.ok)
        throw new Error(
          `OpenAI-compatible request failed (${response.status} ${response.statusText}).`
        )
      if (!response.body)
        throw new Error('OpenAI-compatible provider returned an empty streaming response.')
      const stream = response.body
      return (async function* (): AsyncIterable<UIMessageChunk> {
        const text = createTextChunkEmitter(dependencies.createId)
        const reasoning = createReasoningChunkEmitter(dependencies.createId)
        const tagged = createTaggedThinkingExtractor()
        for await (const event of parseSse(stream)) {
          if (event.data === '[DONE]') break
          const parsed = EventSchema.safeParse(JSON.parse(event.data))
          if (!parsed.success)
            throw new Error(
              'The OpenAI-compatible streaming response contained invalid event data.'
            )
          if (parsed.data.error?.message) throw new Error(parsed.data.error.message)
          const delta = parsed.data.choices?.[0]?.delta
          const nativeReasoning =
            delta?.reasoning_content ?? delta?.reasoning ?? delta?.reasoning_text
          // Compatible servers disagree on the reasoning field name, while the
          // application deliberately has one reasoning stream representation.
          if (nativeReasoning) yield* reasoning.emitDelta(nativeReasoning)
          if (delta?.content) {
            for (const part of tagged.push(delta.content)) {
              if (part.type === 'reasoning') yield* reasoning.emitDelta(part.delta)
              else {
                yield* reasoning.finish()
                yield* text.emitDelta(part.delta)
              }
            }
          }
        }
        for (const part of tagged.finish()) {
          if (part.type === 'reasoning') yield* reasoning.emitDelta(part.delta)
          else {
            yield* reasoning.finish()
            yield* text.emitDelta(part.delta)
          }
        }
        yield* reasoning.finish()
        yield* text.finish()
      })()
    }
  }
}

export { createOpenAICompatibleProvider }
