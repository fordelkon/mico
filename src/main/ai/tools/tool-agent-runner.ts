import type {
  ChatProvider,
  ChatProviderMessage,
  ChatProviderReasoningPart,
  ChatProviderTextPart,
  ChatProviderToolCallPart,
  ThinkingSelection
} from '@mico/ai-providers'
import { isProviderFinish } from '@mico/ai-providers'
import type { UIMessageChunk } from 'ai'
import type { ProviderMetadata } from 'ai'
import * as z from 'zod'

import { ToolRegistry, type ToolCall } from './tool-registry'
import type { ToolExecutionTrace } from './tool-contract'

// MODEL_STEP is one provider.stream() request. The final step is reserved for
// a text answer, so this budget bounds model cost without cutting off a turn.
const MAX_MODEL_STEPS = 24
// TOOL_CALL is one executed side effect. All calls emitted by one model step
// form a tool round and are accepted or rejected as a single batch.
const MAX_TOOL_CALLS = 64
// OUTPUT_TOKEN_RECOVERY is a model-only continuation after a length stop; it is
// intentionally separate from tool and model-step budgets.
const MAX_OUTPUT_TOKEN_RECOVERIES = 1
// TOOL_RESULT_HISTORY_BYTES bounds one tool result before it enters the next
// provider request. It does not affect the complete result persisted for UI.
const MAX_TOOL_RESULT_HISTORY_BYTES = 64 * 1024
const TOOL_RESULT_TRUNCATION_MARKER = '\n\n[Tool output shortened for model context.]\n\n'
const OUTPUT_TOKEN_RECOVERY_MESSAGE =
  'Output token limit hit. Resume directly from where you stopped. Do not apologize or recap.'
const TOOL_BUDGET_EXHAUSTED_MESSAGE =
  'Tool execution budget reached. Use the completed observations and provide your best final answer without calling more tools.'

type ToolAgentRunnerInput = {
  conversationKey: string
  provider: ChatProvider
  messages: ChatProviderMessage[]
  registry?: ToolRegistry
  thinkingEffort: ThinkingSelection
  signal: AbortSignal
  emit: (chunk: UIMessageChunk) => void
  onStep?: (step: AgentStep) => void
  onToolResult?: (trace: ToolExecutionTrace) => void
}
/** One replayable model step: its response and the observations it caused. */
type AgentStep = {
  index: number
  assistant: Extract<ChatProviderMessage, { role: 'assistant' }>
  toolResults: Awaited<ReturnType<ToolRegistry['execute']>>[]
}

const ToolInputAvailableChunkSchema = z.object({
  type: z.literal('tool-input-available'),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  input: z.record(z.string(), z.json())
})
const ReasoningStartChunkSchema = z.object({
  type: z.literal('reasoning-start'),
  id: z.string().min(1)
})
const ReasoningDeltaChunkSchema = z.object({
  type: z.literal('reasoning-delta'),
  id: z.string().min(1),
  delta: z.string()
})
const ReasoningEndChunkSchema = z.object({
  type: z.literal('reasoning-end'),
  id: z.string().min(1),
  providerMetadata: z.custom<ProviderMetadata>().optional()
})
const FinishChunkSchema = z.object({
  type: z.literal('finish'),
  finishReason: z.enum(['length', 'stop', 'tool-calls', 'unknown']).optional()
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
    onStep,
    onToolResult
  }: ToolAgentRunnerInput): Promise<{
    assistantText: string
    finalAssistant: Extract<ChatProviderMessage, { role: 'assistant' }>
  }> {
    let history = [...messages]
    let assistantText = ''
    let callCount = 0
    let outputTokenRecoveries = 0
    let toolRoundCount = 0
    let mustFinish = false
    for (let modelStep = 1; modelStep <= MAX_MODEL_STEPS; modelStep += 1) {
      signal.throwIfAborted()
      const request = {
        conversationKey,
        messages: history,
        thinkingEffort,
        signal
      }
      // Reserve the final model step for a text response. Tool rounds are bounded by
      // model steps, while a separate call budget limits side effects.
      if (registry && !mustFinish && modelStep < MAX_MODEL_STEPS)
        Object.assign(request, { tools: registry.definitions })
      const stream = await provider.stream(request)
      const calls: ToolCall[] = []
      const parts: Array<
        ChatProviderReasoningPart | ChatProviderTextPart | ChatProviderToolCallPart
      > = []
      const reasoningParts = new Map<string, ChatProviderReasoningPart>()
      let finishReason: 'length' | 'stop' | 'tool-calls' | 'unknown' = 'stop'
      let continuation: Extract<ChatProviderMessage, { role: 'assistant' }>['replay']
      for await (const chunk of stream) {
        // Provider-finish is protocol state for the runner. It must never cross
        // the main/renderer boundary as an AI SDK UI message chunk.
        if (isProviderFinish(chunk)) {
          continuation = chunk.continuation
          finishReason =
            chunk.reason === 'length'
              ? 'length'
              : chunk.reason === 'tool-calls'
                ? 'tool-calls'
                : 'stop'
          continue
        }
        if (chunk.type === 'text-delta') {
          assistantText += chunk.delta
          appendTextPart(parts, chunk.delta)
        }
        if (chunk.type === 'tool-input-start') {
          emit({ ...chunk, dynamic: true })
          continue
        }
        const finish = FinishChunkSchema.safeParse(chunk)
        if (finish.success) {
          finishReason = finish.data.finishReason ?? 'stop'
          continue
        }
        const reasoningStart = ReasoningStartChunkSchema.safeParse(chunk)
        if (reasoningStart.success) {
          const part: ChatProviderReasoningPart = { type: 'reasoning', text: '' }
          reasoningParts.set(reasoningStart.data.id, part)
          parts.push(part)
          emit(chunk)
          continue
        }
        const reasoningDelta = ReasoningDeltaChunkSchema.safeParse(chunk)
        if (reasoningDelta.success) {
          const part = reasoningParts.get(reasoningDelta.data.id)
          if (part) part.text += reasoningDelta.data.delta
          emit(chunk)
          continue
        }
        const reasoningEnd = ReasoningEndChunkSchema.safeParse(chunk)
        if (reasoningEnd.success) {
          const part = reasoningParts.get(reasoningEnd.data.id)
          if (part && reasoningEnd.data.providerMetadata)
            part.providerMetadata = reasoningEnd.data.providerMetadata
          emit(chunk)
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
        calls.push(call)
        parts.push({
          type: 'tool-call',
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          argumentsJson: JSON.stringify(call.input)
        })
        emit({ ...chunk, dynamic: true })
      }
      const assistant = {
        role: 'assistant' as const,
        parts: parts.filter((part) => part.type !== 'reasoning' || part.text)
      }
      const replayAssistant = continuation ? { ...assistant, replay: continuation } : assistant
      if (!calls.length) {
        const finalAssistant = replayAssistant
        if (finishReason !== 'length') return { assistantText, finalAssistant }
        if (outputTokenRecoveries >= MAX_OUTPUT_TOKEN_RECOVERIES)
          throw new Error(
            'The model reached its output token limit twice. Lower thinking effort or increase the model output limit and try again.'
          )
        // Preserve the partial provider-visible response before asking the model
        // to continue. The single-retry cap prevents a provider limit from
        // turning one user request into an unbounded hidden conversation.
        history = [
          ...history,
          replayAssistant,
          { role: 'user', parts: [{ type: 'text', text: OUTPUT_TOKEN_RECOVERY_MESSAGE }] }
        ]
        outputTokenRecoveries += 1
        continue
      }
      if (!registry) throw new Error('The model requested a tool outside a project session.')
      toolRoundCount += 1
      const exceedsCallBudget = callCount + calls.length > MAX_TOOL_CALLS
      const executionStartedAt = Date.now()
      const rawResults = exceedsCallBudget
        ? calls.map((call) => toolBudgetExceededResult(call))
        : await registry.executeBatch(calls, signal)
      const executionFinishedAt = Date.now()
      if (!exceedsCallBudget) callCount += calls.length
      const results = rawResults.map(boundToolResultForHistory)
      onStep?.({ index: toolRoundCount, assistant: replayAssistant, toolResults: results })
      for (const [index, result] of rawResults.entries()) {
        const call = calls[index]
        if (!call) continue
        onToolResult?.({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: call.input,
          isError: result.isError,
          output: result.output,
          startedAt: executionStartedAt,
          finishedAt: executionFinishedAt
        })
        emitToolResult(result, emit)
      }
      history = [
        ...history,
        replayAssistant,
        {
          role: 'tool',
          parts: results
        }
      ]
      if (exceedsCallBudget) {
        mustFinish = true
        history.push({
          role: 'user',
          parts: [{ type: 'text', text: TOOL_BUDGET_EXHAUSTED_MESSAGE }]
        })
      }
    }
    throw new Error('The agent reached its model step limit before producing a final answer.')
  }
}

function toolBudgetExceededResult(call: ToolCall): Awaited<ReturnType<ToolRegistry['execute']>> {
  return {
    type: 'tool-result',
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    output: TOOL_BUDGET_EXHAUSTED_MESSAGE,
    isError: true
  }
}

function boundToolResultForHistory(
  result: Awaited<ReturnType<ToolRegistry['execute']>>
): Awaited<ReturnType<ToolRegistry['execute']>> {
  if (Buffer.byteLength(result.output) <= MAX_TOOL_RESULT_HISTORY_BYTES) return result
  const bytes = Buffer.from(result.output)
  const markerBytes = Buffer.byteLength(TOOL_RESULT_TRUNCATION_MARKER)
  const contentBytes = MAX_TOOL_RESULT_HISTORY_BYTES - markerBytes
  const headBytes = Math.floor(contentBytes * 0.75)
  const tailBytes = contentBytes - headBytes
  return {
    ...result,
    output: `${bytes.subarray(0, headBytes).toString()}${TOOL_RESULT_TRUNCATION_MARKER}${bytes
      .subarray(bytes.byteLength - tailBytes)
      .toString()}`
  }
}

function appendTextPart(
  parts: Array<ChatProviderReasoningPart | ChatProviderTextPart | ChatProviderToolCallPart>,
  delta: string
): void {
  const previous = parts.at(-1)
  if (previous?.type === 'text') {
    previous.text += delta
    return
  }
  parts.push({ type: 'text', text: delta })
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
export type { AgentStep }
