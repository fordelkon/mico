import type { ProviderMetadata, UIMessageChunk } from 'ai'
import * as z from 'zod'

import type {
  ChatProvider,
  ChatProviderConfiguration,
  ChatProviderDependencies,
  ChatProviderMessage,
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
      type: z.enum(['text', 'thinking']),
      text: z.string().optional(),
      thinking: z.string().optional()
    })
    .optional(),
  delta: z
    .object({
      type: z.string().optional(),
      text: z.string().optional(),
      thinking: z.string().optional(),
      signature: z.string().optional()
    })
    .optional(),
  usage: z.object({ output_tokens: z.number().nonnegative().optional() }).optional(),
  error: z.object({ message: z.string().optional() }).optional()
})
const SignatureSchema = z.object({ signature: z.string() })

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
  const content: Array<
    { type: 'text'; text: string } | { type: 'thinking'; thinking: string; signature: string }
  > = []
  for (const part of message.parts) {
    if (part.type === 'text') {
      content.push({ type: 'text', text: part.text })
      continue
    }
    const signature = getSignature(part)
    if (signature) content.push({ type: 'thinking', thinking: part.text, signature })
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
    stream: async ({ messages, thinkingEffort, signal, onPerformanceMetrics }) => {
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
      const send = (includeThinking: boolean) => {
        const thinking = getThinking(includeThinking)
        const body = thinking ? { ...request, thinking } : request
        return dependencies.fetch(getUrl(configuration.baseUrl), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': configuration.apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify(body),
          signal
        })
      }
      const response =
        isOptimisticThinkingEffort(thinkingEffort) && thinkingEffort !== 'none'
          ? await fetchWithThinkingFallback(thinkingEffort, send)
          : await send(false)
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
        for await (const event of parseSse(stream)) {
          if (event.data === '[DONE]') break
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
          if (event.event === 'content_block_stop') {
            const signature = signatures.get(index)
            yield* reasoning
              .get(index)
              ?.finish(
                signature ? ({ anthropic: { signature } } satisfies ProviderMetadata) : undefined
              ) ?? []
          }
          if (event.event === 'error')
            throw new Error(
              parsed.data.error?.message ?? 'The Anthropic-compatible provider returned an error.'
            )
          if (event.event === 'message_stop') break
        }
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
