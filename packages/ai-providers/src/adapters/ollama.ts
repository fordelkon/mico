import * as z from 'zod'

import type {
  ChatProvider,
  ChatProviderConfiguration,
  ChatProviderDependencies,
  ChatProviderMessage,
  ChatProviderTool,
  JsonObject,
  ProviderPerformanceMetrics,
  ProviderStreamPart,
  ThinkingSelection
} from '../contracts'
import { providerFinish } from '../contracts'
import { ProviderError, assertProviderResponse, providerApiError } from '../provider-error'
import { parseNdjson } from '../streaming/ndjson'
import { createStreamSequencer } from '../streaming/sequencer'
import { createToolCallAssembler } from '../streaming/tool-calls'
import { getOptimisticThinkingCapabilities } from '../thinking-preferences'
import { getNativeApiUrl } from '../url'

type OllamaConfiguration = Extract<ChatProviderConfiguration, { provider: 'ollama' }>
type OllamaMessage = {
  role: ChatProviderMessage['role']
  content: string
  thinking?: string
  tool_calls?: Array<{
    id?: string
    type: 'function'
    function: { name: string; arguments: JsonObject }
  }>
  tool_name?: string
}
type OllamaRequest = {
  model: string
  messages: OllamaMessage[]
  stream: true
  think?: boolean | string
  tools?: Array<{
    type: 'function'
    function: {
      name: string
      description: string
      parameters: ChatProviderTool['inputSchema']
    }
  }>
}
const ChunkSchema = z.object({
  message: z
    .object({
      content: z.string().optional(),
      thinking: z.string().optional(),
      tool_calls: z
        .array(
          z.object({
            id: z.string().optional(),
            function: z.object({
              name: z.string(),
              arguments: z.json()
            })
          })
        )
        .optional()
    })
    .optional(),
  done: z.boolean().optional(),
  done_reason: z.string().optional(),
  eval_count: z.number().nonnegative().optional(),
  eval_duration: z.number().positive().optional(),
  error: z.string().optional()
})
const ModelDetailsSchema = z.object({ capabilities: z.array(z.string()) })
const ToolArgumentsSchema = z.record(z.string(), z.json())
function getModelDetailsUrl(baseUrl: string): string {
  return getNativeApiUrl(baseUrl, 'api/show')
}
function toMessages(messages: ChatProviderMessage[]) {
  return messages.flatMap((message): OllamaMessage[] => {
    if (message.role === 'tool')
      return message.parts.flatMap((part) =>
        part.type === 'tool-result'
          ? [{ role: 'tool', content: part.output, tool_name: part.toolName }]
          : []
      )
    const result: OllamaMessage = {
      role: message.role,
      content: message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')
    }
    const thinking = message.parts
      .flatMap((part) => (part.type === 'reasoning' ? [part.text] : []))
      .join('\n')
    if (message.role === 'assistant' && thinking) result.thinking = thinking
    if (message.role === 'assistant') {
      const calls = message.parts.flatMap((part) =>
        part.type === 'tool-call'
          ? [
              {
                id: part.toolCallId,
                type: 'function' as const,
                function: {
                  name: part.toolName,
                  arguments: ToolArgumentsSchema.parse(JSON.parse(part.argumentsJson))
                }
              }
            ]
          : []
      )
      if (calls.length) result.tool_calls = calls
    }
    return [result]
  })
}
function toTools(tools: readonly ChatProviderTool[]) {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema }
  }))
}
function toThink(selection: ThinkingSelection): boolean | string | undefined {
  // Ollama accepts false to disable thinking and uses max for its highest
  // supported level; the other shared preferences are passed through directly.
  if (selection === 'none') return false
  if (selection === 'auto') return true
  if (selection === 'default') return undefined
  return selection === 'xhigh' ? 'max' : selection
}
function createOllamaProvider(
  configuration: OllamaConfiguration,
  dependencies: ChatProviderDependencies,
  chatUrl: string
): ChatProvider {
  return {
    getModelCapabilities: async () => {
      const response = await dependencies.fetch(getModelDetailsUrl(configuration.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: configuration.modelId })
      })
      await assertProviderResponse(response)
      const details = ModelDetailsSchema.safeParse(await response.json())
      if (!details.success) throw new Error('Ollama returned invalid model capabilities.')
      return details.data.capabilities.includes('thinking')
        ? getOptimisticThinkingCapabilities()
        : null
    },
    stream: async ({ messages, tools, thinkingEffort, signal, onPerformanceMetrics }) => {
      const think = toThink(thinkingEffort)
      const body: OllamaRequest = {
        model: configuration.modelId,
        messages: toMessages(messages),
        stream: true
      }
      if (tools?.length) body.tools = toTools(tools)
      if (think !== undefined) body.think = think
      const response = await dependencies.fetch(chatUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal
      })
      await assertProviderResponse(response, signal)
      const stream = response.body!
      return (async function* (): AsyncIterable<ProviderStreamPart> {
        const seq = createStreamSequencer(dependencies.createId)
        const assembler = createToolCallAssembler(
          'The Ollama provider returned invalid tool arguments.'
        )
        let finishReason: 'length' | 'stop' | 'unknown' = 'stop'
        let completed = false
        for await (const value of parseNdjson(stream)) {
          const parsed = ChunkSchema.safeParse(value)
          if (!parsed.success)
            throw new Error('The Ollama streaming response contained invalid event data.')
          if (parsed.data.error) throw providerApiError(parsed.data.error)
          if (parsed.data.message?.thinking) yield* seq.emitReasoning(parsed.data.message.thinking)
          if (parsed.data.message?.content) yield* seq.emitText(parsed.data.message.content)
          for (const call of parsed.data.message?.tool_calls ?? []) {
            const toolCallId = call.id ?? dependencies.createId()
            yield* assembler.start(toolCallId, call.function.name)
            const argumentsResult = ToolArgumentsSchema.safeParse(call.function.arguments)
            yield* assembler.completeValue(
              toolCallId,
              call.function.name,
              argumentsResult.success
                ? { isValid: true, input: argumentsResult.data }
                : { isValid: false, invalidInput: call.function.arguments }
            )
          }
          if (parsed.data.done) {
            completed = true
            finishReason =
              parsed.data.done_reason === 'length'
                ? 'length'
                : parsed.data.done_reason === 'stop' || !parsed.data.done_reason
                  ? 'stop'
                  : 'unknown'
            if (parsed.data.eval_count !== undefined) {
              const metrics: ProviderPerformanceMetrics = {
                outputTokens: parsed.data.eval_count
              }
              if (parsed.data.eval_duration !== undefined)
                metrics.tokensPerSecond =
                  (parsed.data.eval_count * 1_000_000_000) / parsed.data.eval_duration
              onPerformanceMetrics?.(metrics)
            }
            break
          }
        }
        if (!completed) throw new ProviderError('incomplete_stream')
        yield* seq.finish()
        yield providerFinish({ reason: finishReason })
      })()
    }
  }
}
export { createOllamaProvider }
