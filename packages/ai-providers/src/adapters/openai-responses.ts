import type { UIMessageChunk } from 'ai'
import * as z from 'zod'

import type {
  ChatProvider,
  ChatProviderConfiguration,
  ChatProviderDependencies,
  ChatProviderMessage
} from '../contracts'
import { parseSse } from '../streaming/sse'
import { createTextChunkEmitter } from '../streaming/text-chunks'
import { createReasoningChunkEmitter } from '../streaming/parts'
import { createThinkingFallback, getOptimisticThinkingCapabilities } from '../thinking-preferences'

type OpenAIResponsesConfiguration = Extract<
  ChatProviderConfiguration,
  { provider: 'openai-responses' }
>
const OpenAIEventSchema = z.object({
  delta: z.string().optional(),
  message: z.string().optional(),
  error: z.object({ message: z.string().optional() }).optional()
})
type OpenAIEvent = z.infer<typeof OpenAIEventSchema>

function getOpenAIResponsesUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  const pathname = url.pathname.replace(/\/+$/, '')
  if (pathname.endsWith('/responses')) return url.toString()
  // Providers such as Ark publish versioned roots (/v2, /v3); only unversioned
  // OpenAI-style roots need the conventional /v1 segment added.
  url.pathname = /\/v\d+$/.test(pathname) ? `${pathname}/responses` : `${pathname}/v1/responses`
  return url.toString()
}
function toOpenAIInput(messages: ChatProviderMessage[]) {
  return messages.flatMap((message) => {
    const content = message.parts.map((part) => ({ type: 'input_text' as const, text: part.text }))
    return content.length > 0 ? [{ role: message.role, content }] : []
  })
}
function parseEventData(data: string): OpenAIEvent {
  const result = OpenAIEventSchema.safeParse(JSON.parse(data))
  if (!result.success)
    throw new Error('The OpenAI streaming response contained invalid event data.')
  return result.data
}
function createOpenAIResponsesProvider(
  configuration: OpenAIResponsesConfiguration,
  dependencies: ChatProviderDependencies
): ChatProvider {
  const responsesUrl = getOpenAIResponsesUrl(configuration.baseUrl)
  const fetchWithThinkingFallback = createThinkingFallback()
  return {
    getModelCapabilities: async () => getOptimisticThinkingCapabilities(),
    stream: async ({ messages, thinkingEffort, signal }) => {
      const request = { model: configuration.modelId, stream: true, input: toOpenAIInput(messages) }
      // Responses uses a different stream vocabulary from Chat Completions, so
      // reasoning summaries and output text are parsed from response.* events below.
      const response = await fetchWithThinkingFallback(thinkingEffort, (includeThinking) =>
        dependencies.fetch(responsesUrl, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${configuration.apiKey}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify(
            includeThinking
              ? { ...request, reasoning: { effort: thinkingEffort, summary: 'auto' } }
              : request
          ),
          signal
        })
      )
      if (!response.ok)
        throw new Error(`OpenAI request failed (${response.status} ${response.statusText}).`)
      const stream = response.body
      if (!stream) throw new Error('OpenAI returned an empty streaming response.')
      return (async function* (): AsyncIterable<UIMessageChunk> {
        const text = createTextChunkEmitter(dependencies.createId)
        const reasoning = createReasoningChunkEmitter(dependencies.createId)
        for await (const event of parseSse(stream)) {
          const data = parseEventData(event.data)
          if (event.event === 'response.reasoning_summary_text.delta' && data.delta)
            yield* reasoning.emitDelta(data.delta)
          if (event.event === 'response.output_text.delta' && data.delta) {
            yield* reasoning.finish()
            yield* text.emitDelta(data.delta)
          }
          if (event.event === 'response.completed') {
            yield* reasoning.finish()
            yield* text.finish()
            return
          }
          if (event.event === 'error' || event.event === 'response.failed')
            throw new Error(
              data.message ?? data.error?.message ?? 'The OpenAI provider returned an error.'
            )
        }
        yield* reasoning.finish()
        yield* text.finish()
      })()
    }
  }
}
export { createOpenAIResponsesProvider }
