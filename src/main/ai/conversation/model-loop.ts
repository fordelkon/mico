import type {
  ChatProvider,
  ChatProviderMessage,
  ChatProviderReasoningPart,
  ChatProviderStreamInput,
  ChatProviderTextPart,
  ChatProviderToolCallPart,
  ChatProviderToolResultPart,
  ProviderUsage,
  ThinkingSelection
} from '@mico/ai-providers'
import { isProviderFinish, ProviderError } from '@mico/ai-providers'
import type { ContextMeasurement } from '@shared/ai/context-measurement'
import { ToolOutputDeltaDataSchema } from '@shared/ipc/schemas/chat'
import type { ProviderMetadata, UIMessageChunk } from 'ai'
import * as z from 'zod'
import { estimatePreparedContextTokens } from './context-estimator'
import { ModelStepRetry, type RetryEvent } from './model-step-retry'
import { AgentBudgetError } from './turn-failure'
import type {
  ModelStepAccepted,
  ToolExecutionStarted,
  ToolExecutionSettled
} from './journal/tool-journal'
import type { AgentStep } from './journal/transcript'
import {
  MAX_TOOL_RESULT_HISTORY_BYTES,
  type ToolExecutionTrace,
  type ToolCall,
  type ToolRegistry
} from '../workspace'

// OUTPUT_TOKEN_RECOVERY is a model-only continuation after a length stop; it is
// bounded independently of successful tool rounds.
const MAX_OUTPUT_TOKEN_RECOVERIES = 1
const TOOL_RESULT_TRUNCATION_MARKER = '\n\n[Tool output shortened for model context.]\n\n'
const OUTPUT_TOKEN_RECOVERY_MESSAGE =
  'Output token limit hit. Resume directly from where you stopped. Do not apologize or recap.'

type ModelLoopInput = {
  provider: ChatProvider
  messages: ChatProviderMessage[]
  registry?: ToolRegistry
  thinkingEffort: ThinkingSelection
  signal: AbortSignal
  emit: (chunk: UIMessageChunk) => void
  onStep?: (step: AgentStep) => void
  onToolResult?: (trace: ToolExecutionTrace) => void
  journal?: {
    recordModelStep: (step: ModelStepAccepted) => void
    recordToolExecutionStarted: (execution: ToolExecutionStarted) => void
    recordToolExecutionSettled: (execution: ToolExecutionSettled) => void
  }
  prepareMessages?: (history: readonly ChatProviderMessage[]) => ChatProviderMessage[]
  maxAttempts?: number
  retryDelayMs?: number
  onRetry?: (event: RetryEvent) => void
  onContextMeasurement?: (measurement: ContextMeasurement) => void
}
/**
 * The turn's parts in exact stream order across every model step. This is the
 * authoritative transcript for persisted display: positions must survive
 * persistence verbatim (see journal/transcript.ts for the invariant).
 */
type AgentDisplayPart =
  | { type: 'reasoning'; text: string }
  | { type: 'text'; textId: string; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string }

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

class ModelLoop {
  async run({
    provider,
    messages,
    registry,
    thinkingEffort,
    signal,
    emit,
    onStep,
    onToolResult,
    journal,
    prepareMessages = (history) => [...history],
    maxAttempts = 5,
    retryDelayMs = 1_000,
    onRetry,
    onContextMeasurement
  }: ModelLoopInput): Promise<{
    assistantText: string
    finalAssistant: Extract<ChatProviderMessage, { role: 'assistant' }>
    displaySequence: AgentDisplayPart[]
  }> {
    // A tool owns its history budget; fresh and replayed observations follow it alike.
    // Without a workspace there are no skill tools, so only the generic fallback applies.
    const boundForHistory = (result: ChatProviderToolResultPart): ChatProviderToolResultPart =>
      boundToolResultForHistory(
        result,
        registry?.historyBudgetFor(result.toolName) ?? MAX_TOOL_RESULT_HISTORY_BYTES
      )
    let history = messages.map((message) =>
      message.role === 'tool' ? { ...message, parts: message.parts.map(boundForHistory) } : message
    )
    const retry = new ModelStepRetry({ maxAttempts, retryDelayMs, onRetry })
    let assistantText = ''
    let outputTokenRecoveries = 0
    let responseCount = 0
    const displaySequence: AgentDisplayPart[] = []
    // Interactive tasks continue until the model finishes, the user cancels, or a
    // real failure occurs. Successful tool use must not silently remove capabilities.
    for (;;) {
      signal.throwIfAborted()
      const request: ChatProviderStreamInput = {
        messages: prepareMessages(history),
        thinkingEffort,
        signal
      }
      if (registry) request.tools = registry.definitions
      onContextMeasurement?.(estimatePreparedContextTokens(request.messages, request.tools))
      const stream = retry.stream(provider, request)
      const invalidResults: ChatProviderToolResultPart[] = []
      const calls: ToolCall[] = []
      const parts: Array<
        ChatProviderReasoningPart | ChatProviderTextPart | ChatProviderToolCallPart
      > = []
      const reasoningParts = new Map<string, ChatProviderReasoningPart>()
      // Display accumulation mirrors the renderer's part identity: text merges by
      // chunk id, reasoning by its id, tool calls stay in stream position.
      const displayParts: AgentDisplayPart[] = []
      const displayTexts = new Map<string, Extract<AgentDisplayPart, { type: 'text' }>>()
      let finishReason: 'length' | 'stop' | 'tool-calls' | 'unknown' = 'stop'
      let continuation: Extract<ChatProviderMessage, { role: 'assistant' }>['replay']
      let usage: ProviderUsage | undefined
      for await (const chunk of stream) {
        // Provider-finish is protocol state for the runner. It must never cross
        // the main/renderer boundary as an AI SDK UI message chunk.
        if (isProviderFinish(chunk)) {
          if (chunk.reason === 'unknown' || chunk.reason === 'content-filter')
            throw new ProviderError('provider')
          continuation = chunk.continuation
          usage = chunk.usage
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
          let displayText = displayTexts.get(chunk.id)
          if (!displayText) {
            displayText = { type: 'text', textId: chunk.id, text: '' }
            displayTexts.set(chunk.id, displayText)
            displayParts.push(displayText)
          }
          displayText.text += chunk.delta
        }
        if (chunk.type === 'tool-input-start') {
          emit({ ...chunk, dynamic: true })
          continue
        }
        const finish = FinishChunkSchema.safeParse(chunk)
        if (finish.success) {
          if (finish.data.finishReason === 'unknown') throw new ProviderError('provider')
          finishReason = finish.data.finishReason ?? 'stop'
          continue
        }
        const reasoningStart = ReasoningStartChunkSchema.safeParse(chunk)
        if (reasoningStart.success) {
          const part: ChatProviderReasoningPart = { type: 'reasoning', text: '' }
          reasoningParts.set(reasoningStart.data.id, part)
          parts.push(part)
          displayParts.push(part)
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
        if (chunk.type === 'tool-input-error' && chunk.toolCallId && chunk.toolName) {
          parts.push({
            type: 'tool-call',
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            argumentsJson: '{}'
          })
          displayParts.push({
            type: 'tool-call',
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName
          })
          invalidResults.push({
            type: 'tool-result',
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            output: `Invalid tool arguments. ${chunk.errorText} Submit valid JSON object arguments.`,
            isError: true
          })
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
        calls.push(call)
        parts.push({
          type: 'tool-call',
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          argumentsJson: JSON.stringify(call.input)
        })
        displayParts.push({
          type: 'tool-call',
          toolCallId: call.toolCallId,
          toolName: call.toolName
        })
        emit({ ...chunk, dynamic: true })
      }
      displaySequence.push(
        ...displayParts.filter((part) => part.type === 'tool-call' || part.text !== '')
      )
      const assistant = {
        role: 'assistant' as const,
        parts: parts.filter((part) => part.type !== 'reasoning' || part.text)
      }
      const replayAssistant = continuation ? { ...assistant, replay: continuation } : assistant
      journal?.recordModelStep(
        usage === undefined
          ? { index: responseCount + 1, assistant: replayAssistant }
          : { index: responseCount + 1, assistant: replayAssistant, usage }
      )
      if (!calls.length && !invalidResults.length) {
        const shouldContinue =
          finishReason === 'length' && outputTokenRecoveries < MAX_OUTPUT_TOKEN_RECOVERIES
        const step: AgentStep = {
          index: ++responseCount,
          assistant: replayAssistant,
          toolResults: []
        }
        if (shouldContinue) step.continuationPrompt = OUTPUT_TOKEN_RECOVERY_MESSAGE
        onStep?.(step)
        const finalAssistant = replayAssistant
        if (finishReason !== 'length') return { assistantText, finalAssistant, displaySequence }
        if (outputTokenRecoveries >= MAX_OUTPUT_TOKEN_RECOVERIES)
          throw new AgentBudgetError(
            'token_limit',
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
      if (!registry && calls.length)
        throw new Error('The model requested a tool outside a project session.')
      responseCount += 1
      for (const result of invalidResults) {
        const now = Date.now()
        const trace: ToolExecutionTrace = {
          toolCallId: result.toolCallId,
          toolName: result.toolName,
          input: {},
          output: result.output,
          isError: true,
          startedAt: now,
          finishedAt: now
        }
        journal?.recordToolExecutionSettled({ index: responseCount, result, trace })
        onToolResult?.(trace)
        emitToolResult(result, emit)
      }
      const executions = registry
        ? await registry.executeBatch(
            calls,
            signal,
            (delta) => {
              // The renderer reads message parts, so each delta must append there.
              // A shared id would replace earlier deltas; transient parts only reach
              // onData. Durable history still stores the completed tool trace.
              const parsed = ToolOutputDeltaDataSchema.safeParse(delta)
              if (!parsed.success) return
              emit({
                type: 'data-tool-output-delta',
                data: parsed.data
              })
            },
            {
              onExecutionStarted: (call, startedAt) =>
                journal?.recordToolExecutionStarted({
                  index: responseCount,
                  toolCallId: call.toolCallId,
                  startedAt
                }),
              onExecutionSettled: (execution) => {
                journal?.recordToolExecutionSettled({ index: responseCount, ...execution })
                onToolResult?.(execution.trace)
              }
            }
          )
        : []
      const orderedResults = parts.flatMap((part) =>
        part.type === 'tool-call'
          ? [...invalidResults, ...executions.map((execution) => execution.result)].filter(
              (result) => result.toolCallId === part.toolCallId
            )
          : []
      )
      const results = orderedResults.map(boundForHistory)
      onStep?.({ index: responseCount, assistant: replayAssistant, toolResults: results })
      for (const { result } of executions) emitToolResult(result, emit)
      history = [
        ...history,
        replayAssistant,
        {
          role: 'tool',
          parts: results
        }
      ]
    }
  }
}

function boundToolResultForHistory(
  result: ChatProviderToolResultPart,
  maxBytes: number
): ChatProviderToolResultPart {
  if (Buffer.byteLength(result.output) <= maxBytes) return result
  const bytes = Buffer.from(result.output)
  const markerBytes = Buffer.byteLength(TOOL_RESULT_TRUNCATION_MARKER)
  const contentBytes = maxBytes - markerBytes
  const headBytes = Math.floor(contentBytes * 0.75)
  const tailBytes = contentBytes - headBytes
  let headEnd = headBytes
  while (headEnd > 0 && (bytes[headEnd] & 0xc0) === 0x80) headEnd -= 1
  let tailStart = bytes.byteLength - tailBytes
  while (tailStart < bytes.byteLength && (bytes[tailStart] & 0xc0) === 0x80) tailStart += 1
  return {
    ...result,
    output: `${bytes.subarray(0, headEnd).toString()}${TOOL_RESULT_TRUNCATION_MARKER}${bytes.subarray(tailStart).toString()}`
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

function emitToolResult(result: ChatProviderToolResultPart, emit: ModelLoopInput['emit']): void {
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

export type { AgentDisplayPart, AgentStep }
export { ModelLoop }
