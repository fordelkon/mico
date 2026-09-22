import * as z from 'zod'

import type {
  ChatProvider,
  ChatProviderConfiguration,
  ChatProviderDependencies,
  ChatProviderMessage,
  ChatProviderTool,
  ProviderStreamPart
} from '../contracts'
import { providerFinish } from '../contracts'
import { parseSse } from '../streaming/sse'
import { createStreamSequencer } from '../streaming/sequencer'
import { createToolCallAssembler } from '../streaming/tool-calls'
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
      id: z.string().optional(),
      incomplete_details: z.object({ reason: z.string().optional() }).nullable().optional(),
      status: z.string().optional(),
      usage: z
        .object({
          input_tokens: z.number().nonnegative().optional(),
          output_tokens: z.number().nonnegative().optional(),
          output_tokens_details: z
            .object({ reasoning_tokens: z.number().nonnegative().optional() })
            .optional(),
          total_tokens: z.number().nonnegative().optional()
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
  previous_response_id?: string
  stream: true
  input: OpenAIInputItem[]
  tools?: ReturnType<typeof toTools>
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
function getPreviousResponse(
  messages: ChatProviderMessage[]
): { historyStart: number; responseId: string } | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'assistant' && message.replay?.provider === 'openai-responses')
      return { historyStart: index + 1, responseId: message.replay.responseId }
  }
  return undefined
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
  dependencies: ChatProviderDependencies,
  chatUrl: string
): ChatProvider {
  const responsesUrl = chatUrl
  const fetchWithThinkingFallback = createThinkingFallback()
  return {
    getModelCapabilities: async () => getOptimisticThinkingCapabilities(),
    stream: async ({ messages, tools, thinkingEffort, signal, onPerformanceMetrics }) => {
      const previousResponse = getPreviousResponse(messages)
      const request: OpenAIResponsesRequest = {
        model: configuration.modelId,
        stream: true,
        // Responses owns the prior assistant state behind responseId. Re-sending
        // that history would duplicate reasoning and tool calls in the new turn.
        input: toOpenAIInput(
          previousResponse ? messages.slice(previousResponse.historyStart) : messages
        )
      }
      if (previousResponse) request.previous_response_id = previousResponse.responseId
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
      return (async function* (): AsyncIterable<ProviderStreamPart> {
        const seq = createStreamSequencer(dependencies.createId)
        const assembler = createToolCallAssembler(
          'The OpenAI provider returned invalid tool arguments.'
        )
        const calls = new Map<number, { id?: string; name?: string; argumentsJson: string }>()
        for await (const event of parseSse(stream)) {
          const data = parseEventData(event.data)
          if (event.event === 'response.reasoning_summary_text.delta' && data.delta)
            yield* seq.emitReasoning(data.delta)
          if (event.event === 'response.output_text.delta' && data.delta)
            yield* seq.emitText(data.delta)
          const outputIndex = data.output_index ?? 0
          if (event.event === 'response.output_item.added' && data.item?.type === 'function_call') {
            const call = {
              id: data.item.call_id,
              name: data.item.name,
              argumentsJson: data.item.arguments ?? ''
            }
            if (call.id && call.name) yield* assembler.start(call.id, call.name)
            calls.set(outputIndex, call)
          }
          if (event.event === 'response.function_call_arguments.delta' && data.delta) {
            const call = calls.get(outputIndex)
            if (call) {
              call.argumentsJson += data.delta
              if (call.id) yield* assembler.delta(call.id, data.delta)
            }
          }
          if (event.event === 'response.output_item.done' && data.item?.type === 'function_call') {
            const call = calls.get(outputIndex) ?? { argumentsJson: '' }
            call.id = data.item.call_id ?? call.id
            call.name = data.item.name ?? call.name
            if (data.item.arguments !== undefined) call.argumentsJson = data.item.arguments
            if (!call.id || !call.name)
              throw new Error('The OpenAI provider returned an incomplete tool call.')
            yield* assembler.start(call.id, call.name)
            yield* assembler.completeJson(call.id, call.name, call.argumentsJson)
            calls.delete(outputIndex)
          }
          if (event.event === 'response.completed') {
            if (calls.size > 0)
              throw new Error('The OpenAI provider returned an incomplete tool call.')
            if (data.response?.usage?.output_tokens !== undefined)
              onPerformanceMetrics?.({ outputTokens: data.response.usage.output_tokens })
            yield* seq.finish()
            if (data.response?.id)
              yield providerFinish({
                reason: 'stop',
                continuation: { provider: 'openai-responses', responseId: data.response.id },
                usage: toUsage(data.response.usage)
              })
            return
          }
          if (event.event === 'response.incomplete') {
            yield* seq.finish()
            const reason = data.response?.incomplete_details?.reason
            const finish = providerFinish({
              reason: reason === 'max_output_tokens' ? 'length' : 'unknown',
              usage: toUsage(data.response?.usage)
            })
            if (data.response?.id)
              finish.continuation = { provider: 'openai-responses', responseId: data.response.id }
            yield finish
            return
          }
          if (event.event === 'error' || event.event === 'response.failed')
            throw new Error(
              data.message ?? data.error?.message ?? 'The OpenAI provider returned an error.'
            )
        }
        if (calls.size > 0) throw new Error('The OpenAI provider returned an incomplete tool call.')
        yield* seq.finish()
      })()
    }
  }
}
function toUsage(
  usage: z.infer<typeof OpenAIEventSchema>['response'] extends infer Response
    ? Response extends { usage?: infer Usage }
      ? Usage
      : undefined
    : undefined
) {
  if (!usage) return undefined
  const result = {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens,
    totalTokens: usage.total_tokens
  }
  return Object.values(result).some((value) => value !== undefined) ? result : undefined
}
export { createOpenAIResponsesProvider }
