import type { ProviderMetadata, UIMessageChunk } from 'ai'
import * as z from 'zod'

import { createAnthropicHeaders } from '../anthropic-auth'
import type {
  ChatProvider,
  ChatProviderConfiguration,
  ChatProviderDependencies,
  ChatProviderMessage,
  ChatProviderTool,
  JsonObject,
  ThinkingSelection
} from '../contracts'
import { createReasoningChunkEmitter, type ReasoningChunkEmitter } from '../streaming/parts'
import { parseSse } from '../streaming/sse'
import { createTextChunkEmitter } from '../streaming/text-chunks'
import {
  createThinkingFallback,
  getOptimisticThinkingCapabilities,
  isOptimisticThinkingEffort
} from '../thinking-preferences'

type AnthropicConfiguration = Extract<
  ChatProviderConfiguration,
  { provider: 'anthropic-compatible' }
>
type AnthropicRequest = {
  model: string
  max_tokens: number
  messages: Array<NonNullable<ReturnType<typeof toMessage>>>
  stream: true
  system?: string
  thinking?: { type: 'disabled' } | { type: 'enabled'; budget_tokens: number }
  tools?: Array<{
    name: string
    description: string
    input_schema: ChatProviderTool['inputSchema']
  }>
}
type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'tool_use'; id: string; name: string; input: JsonObject }
  | {
      type: 'tool_result'
      tool_use_id: string
      content: string
      is_error: boolean
    }
// 8192 is a conservative fallback, not a universal model limit. Callers can
// provide maxTokens when their endpoint/model has a different output ceiling.
const DEFAULT_MAX_TOKENS = 8192
// Anthropic requires an enabled thinking budget to be at least 1024 and below max_tokens.
const MIN_THINKING_BUDGET = 1024
const thinkingBudgetRatios = new Map<ThinkingSelection, number>([
  ['minimal', 0.125],
  ['low', 0.25],
  ['medium', 0.5],
  ['high', 0.75],
  ['xhigh', 0.875],
  ['max', 1]
])
const EventSchema = z.object({
  index: z.number().int().optional(),
  content_block: z
    .object({
      type: z.enum(['text', 'thinking', 'tool_use']),
      id: z.string().optional(),
      name: z.string().optional(),
      input: z.unknown().optional(),
      text: z.string().optional(),
      thinking: z.string().optional()
    })
    .optional(),
  delta: z
    .object({
      type: z.string().optional(),
      text: z.string().optional(),
      thinking: z.string().optional(),
      signature: z.string().optional(),
      partial_json: z.string().optional()
    })
    .optional(),
  usage: z.object({ output_tokens: z.number().nonnegative().optional() }).optional(),
  error: z.object({ message: z.string().optional() }).optional()
})
const SignatureSchema = z.object({ signature: z.string() })
const ToolArgumentsSchema = z.record(z.string(), z.json())

function getThinkingBudget(selection: ThinkingSelection, maxTokens: number): number | undefined {
  const ratio = thinkingBudgetRatios.get(selection)
  const maxBudget = maxTokens - 1
  if (!ratio || maxBudget < MIN_THINKING_BUDGET) return undefined

  // Preference levels are ratios here because Anthropic controls thinking by
  // token budget, rather than accepting the effort enum used by other protocols.
  return Math.min(maxBudget, Math.max(MIN_THINKING_BUDGET, Math.floor(maxTokens * ratio)))
}

function getUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  const path = url.pathname.replace(/\/+$/, '')
  url.pathname = path.endsWith('/messages')
    ? path
    : path.endsWith('/v1')
      ? `${path}/messages`
      : `${path}/v1/messages`
  return url.toString()
}
function getSignature(
  part: Extract<ChatProviderMessage['parts'][number], { type: 'reasoning' }>
): string | undefined {
  return SignatureSchema.safeParse(part.providerMetadata?.anthropic).data?.signature
}
function toMessage(message: ChatProviderMessage) {
  const content: AnthropicContentBlock[] = []
  if (message.role === 'tool') {
    for (const part of message.parts)
      if (part.type === 'tool-result')
        content.push({
          type: 'tool_result',
          tool_use_id: part.toolCallId,
          content: part.output,
          is_error: part.isError
        })
    return content.length ? { role: 'user' as const, content } : null
  }
  for (const part of message.parts) {
    if (part.type === 'text') {
      content.push({ type: 'text', text: part.text })
      continue
    }
    if (part.type === 'reasoning') {
      const signature = getSignature(part)
      if (signature) content.push({ type: 'thinking', thinking: part.text, signature })
      continue
    }
    if (message.role === 'assistant' && part.type === 'tool-call')
      content.push({
        type: 'tool_use',
        id: part.toolCallId,
        name: part.toolName,
        input: ToolArgumentsSchema.parse(JSON.parse(part.argumentsJson))
      })
  }
  return content.length
    ? { role: message.role === 'system' ? 'user' : message.role, content }
    : null
}
function createAnthropicCompatibleProvider(
  configuration: AnthropicConfiguration,
  dependencies: ChatProviderDependencies
): ChatProvider {
  const maxTokens = configuration.maxTokens ?? DEFAULT_MAX_TOKENS
  const fetchWithThinkingFallback = createThinkingFallback()
  return {
    getModelCapabilities: async () => getOptimisticThinkingCapabilities(),
    stream: async ({ messages, tools, thinkingEffort, signal, onPerformanceMetrics }) => {
      const system = messages
        .filter((message) => message.role === 'system')
        .flatMap((message) =>
          message.parts.filter((part) => part.type === 'text').map((part) => part.text)
        )
        .join('\n')
      const requestMessages = messages
        .filter((message) => message.role !== 'system')
        .map(toMessage)
        .filter((message): message is NonNullable<typeof message> => message !== null)
      const getThinking = (includeThinking: boolean) =>
        includeThinking && thinkingEffort !== 'none'
          ? (() => {
              const budgetTokens = getThinkingBudget(thinkingEffort, maxTokens)
              return budgetTokens
                ? { type: 'enabled' as const, budget_tokens: budgetTokens }
                : undefined
            })()
          : undefined
      const request: AnthropicRequest = {
        model: configuration.modelId,
        max_tokens: maxTokens,
        messages: requestMessages,
        stream: true
      }
      if (system) request.system = system
      if (tools?.length)
        request.tools = tools.map((tool: ChatProviderTool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema
        }))
      const send = (includeThinking: boolean, authentication: 'api-key' | 'bearer' = 'api-key') => {
        const thinking = getThinking(includeThinking)
        const body = thinking ? { ...request, thinking } : request
        const headers = createAnthropicHeaders(
          configuration.apiKey,
          configuration.headers,
          authentication
        )
        headers.set('content-type', 'application/json')
        return dependencies.fetch(getUrl(configuration.baseUrl), {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal
        })
      }
      const sendWithAuthenticationFallback = async (
        includeThinking: boolean
      ): Promise<Response> => {
        const response = await send(includeThinking)
        return response.status === 401 && configuration.apiKey
          ? send(includeThinking, 'bearer')
          : response
      }
      const response =
        isOptimisticThinkingEffort(thinkingEffort) && thinkingEffort !== 'none'
          ? await fetchWithThinkingFallback(thinkingEffort, sendWithAuthenticationFallback)
          : await sendWithAuthenticationFallback(false)
      if (!response.ok)
        throw new Error(
          `Anthropic-compatible request failed (${response.status} ${response.statusText}).`
        )
      if (!response.body)
        throw new Error('Anthropic-compatible provider returned an empty streaming response.')
      const stream = response.body
      return (async function* (): AsyncIterable<UIMessageChunk> {
        const text = createTextChunkEmitter(dependencies.createId)
        const reasoning = new Map<number, ReasoningChunkEmitter>()
        const signatures = new Map<number, string>()
        const toolUses = new Map<
          number,
          { id?: string; name?: string; argumentsJson: string; initialInput?: unknown }
        >()
        for await (const event of parseSse(stream)) {
          if (event.data === '[DONE]') {
            if (toolUses.size > 0)
              throw new Error('The Anthropic-compatible provider returned an incomplete tool call.')
            break
          }
          const parsed = EventSchema.safeParse(JSON.parse(event.data))
          if (!parsed.success)
            throw new Error(
              'The Anthropic-compatible streaming response contained invalid event data.'
            )
          if (parsed.data.error?.message) throw new Error(parsed.data.error.message)
          if (parsed.data.usage?.output_tokens !== undefined)
            onPerformanceMetrics?.({ outputTokens: parsed.data.usage.output_tokens })
          const index = parsed.data.index ?? 0
          if (
            event.event === 'content_block_start' &&
            parsed.data.content_block?.type === 'thinking'
          )
            reasoning.set(index, createReasoningChunkEmitter(dependencies.createId))
          if (
            event.event === 'content_block_delta' &&
            parsed.data.delta?.type === 'thinking_delta' &&
            parsed.data.delta.thinking
          )
            yield* (
              reasoning.get(index) ?? createReasoningChunkEmitter(dependencies.createId)
            ).emitDelta(parsed.data.delta.thinking)
          if (
            event.event === 'content_block_delta' &&
            parsed.data.delta?.type === 'signature_delta' &&
            parsed.data.delta.signature
          )
            signatures.set(index, parsed.data.delta.signature)
          if (
            event.event === 'content_block_delta' &&
            parsed.data.delta?.type === 'text_delta' &&
            parsed.data.delta.text
          )
            yield* text.emitDelta(parsed.data.delta.text)
          if (
            event.event === 'content_block_start' &&
            parsed.data.content_block?.type === 'tool_use'
          ) {
            const toolUse = {
              id: parsed.data.content_block.id,
              name: parsed.data.content_block.name,
              argumentsJson: '',
              initialInput: parsed.data.content_block.input
            }
            toolUses.set(index, toolUse)
            if (toolUse.id && toolUse.name)
              yield {
                type: 'tool-input-start',
                toolCallId: toolUse.id,
                toolName: toolUse.name
              }
          }
          if (
            event.event === 'content_block_delta' &&
            parsed.data.delta?.type === 'input_json_delta'
          ) {
            const tool = toolUses.get(index)
            const delta = parsed.data.delta.partial_json ?? ''
            if (tool) {
              tool.argumentsJson += delta
              if (tool.id && delta)
                yield { type: 'tool-input-delta', toolCallId: tool.id, inputTextDelta: delta }
            }
          }
          if (event.event === 'content_block_stop') {
            const signature = signatures.get(index)
            yield* reasoning
              .get(index)
              ?.finish(
                signature ? ({ anthropic: { signature } } satisfies ProviderMetadata) : undefined
              ) ?? []
            const tool = toolUses.get(index)
            if (tool) {
              if (!tool.id || !tool.name)
                throw new Error(
                  'The Anthropic-compatible provider returned an incomplete tool call.'
                )
              if (!tool.argumentsJson && tool.initialInput === undefined)
                throw new Error(
                  'The Anthropic-compatible provider returned an incomplete tool call.'
                )
              const argumentsJson = tool.argumentsJson || JSON.stringify(tool.initialInput)
              try {
                yield {
                  type: 'tool-input-available',
                  toolCallId: tool.id,
                  toolName: tool.name,
                  input: JSON.parse(argumentsJson)
                }
              } catch {
                yield {
                  type: 'tool-input-error',
                  toolCallId: tool.id,
                  toolName: tool.name,
                  input: argumentsJson,
                  errorText: 'The Anthropic-compatible provider returned invalid tool arguments.'
                }
              }
              toolUses.delete(index)
            }
          }
          if (event.event === 'error')
            throw new Error(
              parsed.data.error?.message ?? 'The Anthropic-compatible provider returned an error.'
            )
          if (event.event === 'message_stop') {
            if (toolUses.size > 0)
              throw new Error('The Anthropic-compatible provider returned an incomplete tool call.')
            break
          }
        }
        if (toolUses.size > 0)
          throw new Error('The Anthropic-compatible provider returned an incomplete tool call.')
        for (const [index, emitter] of reasoning)
          yield* emitter.finish(
            signatures.has(index) ? { anthropic: { signature: signatures.get(index) } } : undefined
          )
        yield* text.finish()
      })()
    }
  }
}

export { createAnthropicCompatibleProvider }
