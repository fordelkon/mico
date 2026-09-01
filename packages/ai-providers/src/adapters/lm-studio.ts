import type { UIMessageChunk } from 'ai'
import * as z from 'zod'

import type {
  ChatProvider,
  ChatProviderConfiguration,
  ChatProviderDependencies,
  ChatProviderMessage,
  ModelReasoningCapabilities,
  ThinkingSelection
} from '../contracts'
import { normalizeCapabilities, resolveThinkingSelection } from '../reasoning'
import { parseSse } from '../streaming/sse'
import { createTextChunkEmitter } from '../streaming/text-chunks'
import { createReasoningChunkEmitter } from '../streaming/parts'

type LMStudioConfiguration = Extract<ChatProviderConfiguration, { provider: 'lm-studio' }>
type RequestHeaders = { authorization?: string; 'content-type': string }
const LMStudioModelsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      capabilities: z
        .object({
          reasoning: z
            .object({ allowed_options: z.array(z.string()), default: z.string() })
            .optional()
        })
        .or(z.array(z.string()))
        .optional()
    })
  )
})
const LMStudioV1ModelsSchema = z.object({
  models: z.array(
    z.object({
      key: z.string(),
      capabilities: z
        .object({
          reasoning: z
            .object({ allowed_options: z.array(z.string()), default: z.string() })
            .optional()
        })
        .optional()
    })
  )
})
const LMStudioEventSchema = z.object({
  content: z.string().optional(),
  delta: z.string().optional(),
  message: z.string().optional(),
  response_id: z.string().optional()
})
const LMStudioResponseMetadataSchema = z.object({ responseId: z.string() })
type LMStudioEvent = z.infer<typeof LMStudioEventSchema>
const LMStudioReasoningOptionSchema = z.enum(['off', 'on', 'low', 'medium', 'high'])
const lmStudioSelections = new Map([
  ['off', 'none'],
  ['on', 'auto'],
  ['low', 'low'],
  ['medium', 'medium'],
  ['high', 'high']
] as const)
const lmStudioOptions = new Map<ThinkingSelection, string>([
  ['none', 'off'],
  ['auto', 'on'],
  ['low', 'low'],
  ['medium', 'medium'],
  ['high', 'high'],
  ['xhigh', 'xhigh']
])
function getEndpoint(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).toString()
}
function getHeaders(apiKey: string | undefined): RequestHeaders {
  const headers: RequestHeaders = { 'content-type': 'application/json' }
  if (apiKey) headers.authorization = `Bearer ${apiKey}`
  return headers
}
function getText(message: ChatProviderMessage): string {
  return message.parts.map((part) => part.text).join('\n')
}
function normalizeLMStudioOption(option: string): string {
  const result = LMStudioReasoningOptionSchema.safeParse(option)
  return result.success ? (lmStudioSelections.get(result.data) ?? result.data) : option
}
function parseEventData(data: string): LMStudioEvent {
  const result = LMStudioEventSchema.safeParse(JSON.parse(data))
  if (!result.success)
    throw new Error('The LM Studio streaming response contained invalid event data.')
  return result.data
}
function createLMStudioProvider(
  configuration: LMStudioConfiguration,
  dependencies: ChatProviderDependencies
): ChatProvider {
  let capabilities: ModelReasoningCapabilities | null = null
  const getModelCapabilities = async (): Promise<ModelReasoningCapabilities | null> => {
    // LM Studio is the exception to optimistic preferences: its model endpoint
    // advertises the selected model's actual reasoning options and default.
    try {
      const response = await dependencies.fetch(
        getEndpoint(configuration.baseUrl, '/api/v1/models'),
        {
          headers: getHeaders(configuration.apiKey)
        }
      )
      if (response.ok) {
        const result = LMStudioV1ModelsSchema.safeParse(await response.json())
        const reasoning = result.success
          ? result.data.models.find((candidate) => candidate.key === configuration.modelId)
              ?.capabilities?.reasoning
          : undefined
        capabilities = reasoning
          ? normalizeCapabilities(
              reasoning.allowed_options.map(normalizeLMStudioOption),
              normalizeLMStudioOption(reasoning.default)
            )
          : null
        return capabilities
      }

      const legacyResponse = await dependencies.fetch(
        getEndpoint(configuration.baseUrl, '/api/v0/models'),
        { headers: getHeaders(configuration.apiKey) }
      )
      if (!legacyResponse.ok) return null
      const legacy = LMStudioModelsSchema.safeParse(await legacyResponse.json())
      const model = legacy.success
        ? legacy.data.data.find((candidate) => candidate.id === configuration.modelId)
        : undefined
      if (!model) return null
      const reasoning = !Array.isArray(model.capabilities)
        ? model.capabilities?.reasoning
        : undefined
      capabilities = reasoning
        ? normalizeCapabilities(
            reasoning.allowed_options.map(normalizeLMStudioOption),
            normalizeLMStudioOption(reasoning.default)
          )
        : { availability: 'unknown', selectableEfforts: ['none', 'auto'], defaultEffort: 'auto' }
      return capabilities
    } catch {
      capabilities = null
      return null
    }
  }
  return {
    getModelCapabilities,
    stream: async ({ messages, thinkingEffort, signal }) => {
      const currentUserMessage = [...messages].reverse().find((message) => message.role === 'user')
      if (!currentUserMessage) throw new Error('LM Studio requires a user message.')
      const previousResponse = LMStudioResponseMetadataSchema.safeParse(
        [...messages].reverse().find((message) => message.role === 'assistant')?.providerMetadata
          ?.lmStudio
      ).data?.responseId
      const systemMessage = messages.find((message) => message.role === 'system')
      const effort = resolveThinkingSelection(thinkingEffort, capabilities)
      const request = {
        model: configuration.modelId,
        input: getText(currentUserMessage),
        stream: true,
        store: true
      }
      const withSystem = systemMessage
        ? { ...request, system_prompt: getText(systemMessage) }
        : request
      const withPrevious = previousResponse
        ? { ...withSystem, previous_response_id: previousResponse }
        : withSystem
      const nativeEffort = effort === 'default' ? undefined : lmStudioOptions.get(effort)
      const body = nativeEffort ? { ...withPrevious, reasoning: nativeEffort } : withPrevious
      const response = await dependencies.fetch(
        getEndpoint(configuration.baseUrl, '/api/v1/chat'),
        {
          method: 'POST',
          headers: getHeaders(configuration.apiKey),
          body: JSON.stringify(body),
          signal
        }
      )
      if (!response.ok)
        throw new Error(`LM Studio request failed (${response.status} ${response.statusText}).`)
      const stream = response.body
      if (!stream) throw new Error('LM Studio returned an empty streaming response.')
      return (async function* (): AsyncIterable<UIMessageChunk> {
        const text = createTextChunkEmitter(dependencies.createId)
        const reasoning = createReasoningChunkEmitter(dependencies.createId)
        for await (const event of parseSse(stream)) {
          const data = parseEventData(event.data)
          const reasoningDelta =
            event.event === 'reasoning.delta' ? (data.delta ?? data.content) : undefined
          if (reasoningDelta) yield* reasoning.emitDelta(reasoningDelta)
          const messageDelta =
            event.event === 'message.delta' ? (data.content ?? data.delta) : undefined
          if (messageDelta) {
            yield* reasoning.finish()
            yield* text.emitDelta(messageDelta)
          }
          if (event.event === 'error')
            throw new Error(data.message ?? 'LM Studio returned an error.')
          if (event.event === 'chat.end') {
            if (data.response_id)
              yield {
                type: 'message-metadata',
                messageMetadata: {
                  providerMetadata: { lmStudio: { responseId: data.response_id } }
                }
              }
            yield* reasoning.finish()
            yield* text.finish()
            return
          }
        }
        yield* reasoning.finish()
        yield* text.finish()
      })()
    }
  }
}
export { createLMStudioProvider }
