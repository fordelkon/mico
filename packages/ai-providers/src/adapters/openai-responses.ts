import type { UIMessageChunk } from 'ai'
import * as z from 'zod'

import type {
  ChatProvider,
  ChatProviderConfiguration,
  ChatProviderDependencies,
  ChatProviderMessage,
  ChatProviderTool
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
  output_index: z.number().int().nonnegative().optional(),
  response: z
    .object({
      usage: z
        .object({
          output_tokens: z.number().nonnegative().optional()
        })
        .optional()
    })
    .optional(),
  error: z.object({ message: z.string().optional() }).optional(),
  item: z
    .object({
      type: z.string().optional(),
      call_id: z.string().optional(),
      name: z.string().optional(),
      arguments: z.string().optional()
    })
    .optional()
})
type OpenAIEvent = z.infer<typeof OpenAIEventSchema>
type OpenAIInputItem =
  | {
      role: 'assistant' | 'system' | 'user'
      content: Array<{ type: 'input_text'; text: string }>
    }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string }
type OpenAIResponsesRequest = {
  model: string
  stream: true
  input: OpenAIInputItem[]
  tools?: ReturnType<typeof toTools>
}

function getOpenAIResponsesUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  const pathname = url.pathname.replace(/\/+$/, '')
  if (pathname.endsWith('/responses')) return url.toString()
  // Providers such as Ark publish versioned roots (/v2, /v3); only unversioned
  // OpenAI-style roots need the conventional /v1 segment added.
  url.pathname = /\/v\d+$/.test(pathname) ? `${pathname}/responses` : `${pathname}/v1/responses`
  return url.toString()
}
function toOpenAIInput(messages: ChatProviderMessage[]): OpenAIInputItem[] {
  const input: OpenAIInputItem[] = []
  for (const message of messages) {
    if (message.role === 'tool') {
      for (const part of message.parts)
        if (part.type === 'tool-result')
          input.push({
            type: 'function_call_output',
            call_id: part.toolCallId,
            output: part.output
          })
      continue
    }
    if (message.role === 'assistant') {
      const hasToolCalls = message.parts.some((part) => part.type === 'tool-call')
      if (hasToolCalls) {
        for (const part of message.parts) {
          if (part.type === 'tool-call') {
            input.push({
              type: 'function_call',
              call_id: part.toolCallId,
              name: part.toolName,
              arguments: part.argumentsJson
            })
            continue
          }
          if ('text' in part)
            input.push({
              role: 'assistant',
              content: [{ type: 'input_text' as const, text: part.text }]
            })
        }
        continue
      }
    }
    const content = message.parts.flatMap((part) =>
      'text' in part ? [{ type: 'input_text' as const, text: part.text }] : []
    )
    if (
      content.length > 0 &&
      (message.role === 'assistant' || message.role === 'system' || message.role === 'user')
    )
      input.push({ role: message.role, content })
  }
  return input
}
function toTools(tools: readonly ChatProviderTool[]) {
  return tools.map((tool) => ({
    type: 'function' as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema
  }))
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
    stream: async ({ messages, tools, thinkingEffort, signal, onPerformanceMetrics }) => {
      const request: OpenAIResponsesRequest = {
        model: configuration.modelId,
        stream: true,
        input: toOpenAIInput(messages)
      }
      if (tools?.length) request.tools = toTools(tools)
      // Responses uses a different stream vocabulary from Chat Completions, so
      // reasoning summaries and output text are parsed from response.* events below.
      const response = await fetchWithThinkingFallback(thinkingEffort, (includeThinking) => {
        const headers = new Headers({
          'content-type': 'application/json',
          ...configuration.headers
        })
        if (configuration.apiKey && !headers.has('authorization'))
          headers.set('authorization', `Bearer ${configuration.apiKey}`)
        return dependencies.fetch(responsesUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(
            includeThinking
              ? { ...request, reasoning: { effort: thinkingEffort, summary: 'auto' } }
              : request
          ),
          signal
        })
      })
      if (!response.ok)
        throw new Error(`OpenAI request failed (${response.status} ${response.statusText}).`)
      const stream = response.body
      if (!stream) throw new Error('OpenAI returned an empty streaming response.')
      return (async function* (): AsyncIterable<UIMessageChunk> {
        const text = createTextChunkEmitter(dependencies.createId)
        const reasoning = createReasoningChunkEmitter(dependencies.createId)
        const calls = new Map<
          number,
          { id?: string; name?: string; argumentsJson: string; started: boolean }
        >()
        for await (const event of parseSse(stream)) {
          const data = parseEventData(event.data)
          if (event.event === 'response.reasoning_summary_text.delta' && data.delta)
            yield* reasoning.emitDelta(data.delta)
          if (event.event === 'response.output_text.delta' && data.delta) {
            yield* reasoning.finish()
            yield* text.emitDelta(data.delta)
          }
          const outputIndex = data.output_index ?? 0
          if (event.event === 'response.output_item.added' && data.item?.type === 'function_call') {
            const call = {
              id: data.item.call_id,
              name: data.item.name,
              argumentsJson: data.item.arguments ?? '',
              started: false
            }
            if (call.id && call.name) {
              yield { type: 'tool-input-start', toolCallId: call.id, toolName: call.name }
              call.started = true
            }
            calls.set(outputIndex, call)
          }
          if (event.event === 'response.function_call_arguments.delta' && data.delta) {
            const call = calls.get(outputIndex)
            if (call) {
              call.argumentsJson += data.delta
              if (call.id)
                yield {
                  type: 'tool-input-delta',
                  toolCallId: call.id,
                  inputTextDelta: data.delta
                }
            }
          }
          if (event.event === 'response.output_item.done' && data.item?.type === 'function_call') {
            const call = calls.get(outputIndex) ?? {
              argumentsJson: '',
              started: false
            }
            call.id = data.item.call_id ?? call.id
            call.name = data.item.name ?? call.name
            if (data.item.arguments !== undefined) call.argumentsJson = data.item.arguments
            if (!call.id || !call.name)
              throw new Error('The OpenAI provider returned an incomplete tool call.')
            if (!call.started)
              yield { type: 'tool-input-start', toolCallId: call.id, toolName: call.name }
            try {
              yield {
                type: 'tool-input-available',
                toolCallId: call.id,
                toolName: call.name,
                input: JSON.parse(call.argumentsJson)
              }
            } catch {
              yield {
                type: 'tool-input-error',
                toolCallId: call.id,
                toolName: call.name,
                input: call.argumentsJson,
                errorText: 'The OpenAI provider returned invalid tool arguments.'
              }
            }
            calls.delete(outputIndex)
          }
          if (event.event === 'response.completed') {
            if (calls.size > 0)
              throw new Error('The OpenAI provider returned an incomplete tool call.')
            if (data.response?.usage?.output_tokens !== undefined)
              onPerformanceMetrics?.({ outputTokens: data.response.usage.output_tokens })
            yield* reasoning.finish()
            yield* text.finish()
            return
          }
          if (event.event === 'response.incomplete')
            throw new Error('The OpenAI provider returned an incomplete response.')
          if (event.event === 'error' || event.event === 'response.failed')
            throw new Error(
              data.message ?? data.error?.message ?? 'The OpenAI provider returned an error.'
            )
        }
        if (calls.size > 0) throw new Error('The OpenAI provider returned an incomplete tool call.')
        yield* reasoning.finish()
        yield* text.finish()
      })()
    }
  }
}
export { createOpenAIResponsesProvider }
