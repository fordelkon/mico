import type { ChatProvider, ChatProviderMessage, ThinkingSelection } from '@mico/ai-providers'
import type { UIMessageChunk } from 'ai'
import * as z from 'zod'

import { ToolRegistry, type ToolCall } from './tool-registry'

const MAX_TOOL_ROUNDS = 12
const MAX_TOOL_CALLS = 32

type ToolAgentRunnerInput = {
  conversationKey: string
  provider: ChatProvider
  messages: ChatProviderMessage[]
  registry?: ToolRegistry
  thinkingEffort: ThinkingSelection
  signal: AbortSignal
  emit: (chunk: UIMessageChunk) => void
  onToolResult?: (trace: CompletedToolTrace) => void
}
type CompletedToolTrace = {
  toolCallId: string
  toolName: string
  input: ToolCall['input']
  isError: boolean
  output: string
  startedAt: number
  finishedAt: number
}

const ToolInputAvailableChunkSchema = z.object({
  type: z.literal('tool-input-available'),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  input: z.record(z.string(), z.json())
})

function toToolCall(chunk: UIMessageChunk): ToolCall | null {
  const parsed = ToolInputAvailableChunkSchema.safeParse(chunk)
  return parsed.success ? parsed.data : null
}

class ToolAgentRunner {
  async run({
    conversationKey,
    provider,
    messages,
    registry,
    thinkingEffort,
    signal,
    emit,
    onToolResult
  }: ToolAgentRunnerInput): Promise<{ assistantText: string }> {
    let history = [...messages]
    let assistantText = ''
    let callCount = 0
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      signal.throwIfAborted()
      const request = {
        conversationKey,
        messages: history,
        thinkingEffort,
        signal
      }
      if (registry) Object.assign(request, { tools: registry.definitions })
      const stream = await provider.stream(request)
      const calls: ToolCall[] = []
      const executions: Array<ReturnType<ToolRegistry['execute']>> = []
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta') assistantText += chunk.delta
        if (chunk.type === 'tool-input-start') {
          emit({ ...chunk, dynamic: true })
          continue
        }
        if (chunk.type !== 'tool-input-available') {
          emit(chunk)
          continue
        }
        const call = toToolCall(chunk)
        if (!call) {
          emit(chunk)
          continue
        }
        if (callCount + calls.length + 1 > MAX_TOOL_CALLS)
          throw new Error('The agent reached its tool call limit. Please start a new request.')
        calls.push(call)
        emit({ ...chunk, dynamic: true })
        if (registry) {
          const startedAt = Date.now()
          const execution = registry.execute(call, signal).then((result) => {
            onToolResult?.({
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              input: call.input,
              isError: result.isError,
              output: result.output,
              startedAt,
              finishedAt: Date.now()
            })
            emitToolResult(result, emit)
            return result
          })
          executions.push(execution)
        }
      }
      if (!calls.length) return { assistantText }
      if (!registry) throw new Error('The model requested a tool outside a project session.')
      callCount += calls.length
      const results = await Promise.all(executions)
      history = [
        ...history,
        {
          role: 'assistant',
          parts: calls.map((call) => ({
            type: 'tool-call' as const,
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            argumentsJson: JSON.stringify(call.input)
          }))
        },
        {
          role: 'tool',
          parts: results
        }
      ]
    }
    throw new Error('The agent reached its tool round limit. Please start a new request.')
  }
}

function emitToolResult(
  result: Awaited<ReturnType<ToolRegistry['execute']>>,
  emit: ToolAgentRunnerInput['emit']
): void {
  if (result.isError) {
    emit({
      type: 'tool-output-error',
      toolCallId: result.toolCallId,
      errorText: result.output,
      dynamic: true
    })
    return
  }
  emit({
    type: 'tool-output-available',
    toolCallId: result.toolCallId,
    output: result.output,
    dynamic: true
  })
}

export { ToolAgentRunner }
export type { CompletedToolTrace }
