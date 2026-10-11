import * as z from 'zod'

import type {
  ChatProvider,
  ChatProviderConfiguration,
  ChatProviderDependencies,
  ChatProviderMessage,
  ChatProviderTool,
  ProviderFinishReason,
  ProviderStreamPart
} from '../contracts'
import { providerFinish } from '../contracts'
import { ProviderError, assertProviderResponse, providerApiError } from '../provider-error'
import { createRequestNegotiator } from '../request-negotiator'
import { parseEvent } from '../streaming/event-parse'
import { parseSse } from '../streaming/sse'
import { createStreamSequencer } from '../streaming/sequencer'
import { createTaggedThinkingExtractor } from '../streaming/tagged-thinking'
import { createToolCallAssembler } from '../streaming/tool-calls'
import { getOptimisticThinkingCapabilities } from '../thinking-preferences'

type OpenAICompatibleConfiguration = Extract<
  ChatProviderConfiguration,
  { provider: 'openai-compatible' }
>
type OpenAICompatibleRequest = {
  model: string
  messages: ReturnType<typeof toMessages>
  stream: true
  stream_options?: { include_usage: true }
  tools?: Array<{
    type: 'function'
    function: {
      name: string
      description: string
      parameters: ChatProviderTool['inputSchema']
    }
  }>
}
// Compatible servers disagree on documented shapes: reasoning fields arrive as
// null, single tool calls omit the index, multimodal servers stream content as
// parts, and gateways send in-stream errors as a plain string. Accept those
// variants instead of failing the stream.
const EventSchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: z
              .union([
                z.string(),
                z
                  .array(z.object({ text: z.string().optional() }))
                  .transform((parts) => parts.map((part) => part.text ?? '').join(''))
              ])
              .nullable()
              .optional()
              .transform((content) => content ?? undefined),
            reasoning: z.string().nullable().optional(),
            reasoning_content: z.string().nullable().optional(),
            reasoning_text: z.string().nullable().optional(),
            tool_calls: z
              .array(
                z.object({
                  // Only merges concurrent anonymous calls, which no known
                  // compatible server emits alongside an omitted index.
                  index: z.number().int().optional(),
                  id: z.string().optional(),
                  function: z
                    .object({ name: z.string().optional(), arguments: z.string().optional() })
                    .optional()
                })
              )
              .optional()
          })
          .nullable()
          .optional(),
        finish_reason: z.string().nullable().optional()
      })
    )
    .nullable()
    .optional(),
  usage: z
    .object({
      completion_tokens: z
        .number()
        .nonnegative()
        .nullable()
        .optional()
        .transform((value) => value ?? undefined)
    })
    .nullable()
    .optional(),
  error: z
    .union([
      z.string().transform((message) => ({ message })),
      z.object({
        message: z.string().optional(),
        code: z.string().nullable().optional(),
        type: z.string().optional()
      })
    ])
    .optional()
})

type OpenAICompatibleMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: Array<{
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }>
    }
  | { role: 'tool'; tool_call_id: string; content: string }

function toMessages(messages: ChatProviderMessage[]): OpenAICompatibleMessage[] {
  const result: OpenAICompatibleMessage[] = []
  for (const message of messages) {
    if (message.role === 'tool') {
      for (const part of message.parts)
        if (part.type === 'tool-result')
          result.push({ role: 'tool', tool_call_id: part.toolCallId, content: part.output })
      continue
    }
    const toolCalls = message.parts.flatMap((part) =>
      part.type === 'tool-call'
        ? [
            {
              id: part.toolCallId,
              type: 'function' as const,
              function: { name: part.toolName, arguments: part.argumentsJson }
            }
          ]
        : []
    )
    const content = message.parts
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .join('\n')
    if (message.role === 'assistant' && toolCalls.length) {
      result.push({
        role: 'assistant',
        content: content || null,
        tool_calls: toolCalls
      })
      continue
    }
    if (content) result.push({ role: message.role, content })
  }
  return result
}
function toTools(tools: readonly ChatProviderTool[]) {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema }
  }))
}
function createOpenAICompatibleProvider(
  configuration: OpenAICompatibleConfiguration,
  dependencies: ChatProviderDependencies,
  chatUrl: string
): ChatProvider {
  const negotiate = createRequestNegotiator({
    supportsFallbackAuth: false,
    supportsFallbackThinking: false
  })
  return {
    getModelCapabilities: async () => getOptimisticThinkingCapabilities(),
    stream: async ({
      collectPerformanceMetrics,
      messages,
      tools,
      thinkingEffort,
      signal,
      onPerformanceMetrics
    }) => {
      const headers = new Headers({
        'content-type': 'application/json',
        ...configuration.headers
      })
      if (configuration.apiKey && !headers.has('authorization'))
        headers.set('authorization', `Bearer ${configuration.apiKey}`)
      const request: OpenAICompatibleRequest = {
        model: configuration.modelId,
        messages: toMessages(messages),
        stream: true
      }
      if (tools?.length) request.tools = toTools(tools)
      if (collectPerformanceMetrics) request.stream_options = { include_usage: true }
      const response = await negotiate({
        signal,
        thinkingEffort,
        attempt: (variant) =>
          dependencies.fetch(chatUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(
              variant.includeThinking ? { ...request, reasoning_effort: thinkingEffort } : request
            ),
            signal
          })
      })
      await assertProviderResponse(response, signal)
      const stream = response.body!
      return (async function* (): AsyncIterable<ProviderStreamPart> {
        const seq = createStreamSequencer(dependencies.createId)
        const assembler = createToolCallAssembler(
          'The OpenAI-compatible provider returned invalid tool arguments.'
        )
        const tagged = createTaggedThinkingExtractor()
        const toolCalls = new Map<
          number,
          {
            id?: string
            name?: string
            argumentsJson: string
            pendingDeltas: string[]
          }
        >()
        let finishReason: ProviderFinishReason = 'stop'
        let completed = false
        for await (const event of parseSse(stream)) {
          if (event.data === '[DONE]') {
            if (toolCalls.size > 0) throw new ProviderError('incomplete_stream')
            break
          }
          const parsed = parseEvent(EventSchema, 'OpenAI-compatible', event.data)
          if (parsed.error) throw providerApiError(parsed.error)
          if (parsed.usage?.completion_tokens !== undefined)
            onPerformanceMetrics?.({ outputTokens: parsed.usage.completion_tokens })
          const delta = parsed.choices?.[0]?.delta
          const nativeFinishReason = parsed.choices?.find(
            (choice) => choice.finish_reason !== null && choice.finish_reason !== undefined
          )?.finish_reason
          if (nativeFinishReason) {
            completed = true
            finishReason =
              nativeFinishReason === 'length'
                ? 'length'
                : nativeFinishReason === 'content_filter'
                  ? 'content-filter'
                  : nativeFinishReason === 'tool_calls'
                    ? 'tool-calls'
                    : nativeFinishReason === 'stop'
                      ? 'stop'
                      : 'unknown'
          }
          const nativeReasoning =
            delta?.reasoning_content ?? delta?.reasoning ?? delta?.reasoning_text
          // Compatible servers disagree on the reasoning field name, while the
          // application deliberately has one reasoning stream representation.
          if (nativeReasoning) yield* seq.emitReasoning(nativeReasoning)
          for (const part of tagged.push(delta?.content ?? '')) {
            if (part.type === 'reasoning') yield* seq.emitReasoning(part.delta)
            else yield* seq.emitText(part.delta)
          }
          for (const call of delta?.tool_calls ?? []) {
            const callIndex = call.index ?? 0
            const current = toolCalls.get(callIndex) ?? {
              argumentsJson: '',
              pendingDeltas: []
            }
            if (call.id) current.id = call.id
            if (call.function?.name) current.name = call.function.name
            const isStarted = Boolean(current.id && current.name)
            if (current.id && current.name) {
              // assembler.start is idempotent, so it can run on every delta once
              // the id and name are known; buffered deltas flush right after it.
              yield* assembler.start(current.id, current.name)
              for (const inputTextDelta of current.pendingDeltas)
                yield* assembler.delta(current.id, inputTextDelta)
              current.pendingDeltas = []
            }
            if (call.function?.arguments) {
              current.argumentsJson += call.function.arguments
              if (current.id && isStarted)
                yield* assembler.delta(current.id, call.function.arguments)
              else current.pendingDeltas.push(call.function.arguments)
            }
            toolCalls.set(callIndex, current)
          }
          if (parsed.choices?.some((choice) => choice.finish_reason === 'tool_calls')) {
            for (const call of toolCalls.values()) {
              if (!call.id || !call.name) throw new ProviderError('incomplete_stream')
              yield* assembler.start(call.id, call.name)
              yield* assembler.completeJson(call.id, call.name, call.argumentsJson)
            }
            toolCalls.clear()
          }
        }
        if (toolCalls.size > 0) throw new ProviderError('incomplete_stream')
        if (!completed) throw new ProviderError('incomplete_stream')
        for (const part of tagged.finish()) {
          if (part.type === 'reasoning') yield* seq.emitReasoning(part.delta)
          else yield* seq.emitText(part.delta)
        }
        yield* seq.finish()
        yield providerFinish({ reason: finishReason })
      })()
    }
  }
}

export { createOpenAICompatibleProvider }
