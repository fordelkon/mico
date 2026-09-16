import type { UIMessageChunk } from 'ai'
import * as z from 'zod'

import type {
  ChatProvider,
  ChatProviderConfiguration,
  ChatProviderDependencies,
  ChatProviderMessage,
  ChatProviderTool
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
const EventSchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: z.string().nullable().optional(),
            reasoning: z.string().optional(),
            reasoning_content: z.string().optional(),
            reasoning_text: z.string().optional(),
            tool_calls: z
              .array(
                z.object({
                  index: z.number().int(),
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
  dependencies: ChatProviderDependencies
): ChatProvider {
  const fetchWithThinkingFallback = createThinkingFallback()
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
        const toolCalls = new Map<
          number,
          {
            id?: string
            name?: string
            argumentsJson: string
            pendingDeltas: string[]
            started: boolean
          }
        >()
        for await (const event of parseSse(stream)) {
          if (event.data === '[DONE]') {
            if (toolCalls.size > 0)
              throw new Error('The OpenAI-compatible provider returned an incomplete tool call.')
            break
          }
          const parsed = EventSchema.safeParse(JSON.parse(event.data))
          if (!parsed.success)
            throw new Error(
              'The OpenAI-compatible streaming response contained invalid event data.'
            )
          if (parsed.data.error?.message) throw new Error(parsed.data.error.message)
          if (parsed.data.usage?.completion_tokens !== undefined)
            onPerformanceMetrics?.({ outputTokens: parsed.data.usage.completion_tokens })
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
          for (const call of delta?.tool_calls ?? []) {
            const current = toolCalls.get(call.index) ?? {
              argumentsJson: '',
              pendingDeltas: [],
              started: false
            }
            if (call.id) current.id = call.id
            if (call.function?.name) current.name = call.function.name
            if (current.id && current.name && !current.started) {
              yield {
                type: 'tool-input-start',
                toolCallId: current.id,
                toolName: current.name
              }
              current.started = true
              for (const inputTextDelta of current.pendingDeltas)
                yield { type: 'tool-input-delta', toolCallId: current.id, inputTextDelta }
              current.pendingDeltas = []
            }
            if (call.function?.arguments) {
              current.argumentsJson += call.function.arguments
              if (!current.started) current.pendingDeltas.push(call.function.arguments)
            }
            toolCalls.set(call.index, current)
            if (current.id && current.started && call.function?.arguments) {
              yield {
                type: 'tool-input-delta',
                toolCallId: current.id,
                inputTextDelta: call.function.arguments
              }
            }
          }
          if (parsed.data.choices?.some((choice) => choice.finish_reason === 'tool_calls')) {
            for (const call of toolCalls.values()) {
              if (!call.id || !call.name)
                throw new Error('The OpenAI-compatible provider returned an incomplete tool call.')
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
                  errorText: 'The OpenAI-compatible provider returned invalid tool arguments.'
                }
              }
            }
            toolCalls.clear()
          }
        }
        if (toolCalls.size > 0)
          throw new Error('The OpenAI-compatible provider returned an incomplete tool call.')
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
