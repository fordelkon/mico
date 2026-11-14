import type {
  ChatProvider,
  ChatProviderAssistantMessage,
  ChatProviderMessage,
  ChatProviderReasoningPart,
  ChatProviderStreamInput,
  ChatProviderToolResultPart,
  ProviderUsage,
  ThinkingSelection
} from '@mico/ai-providers'
import { isProviderFinish, ProviderError } from '@mico/ai-providers'
import type { ProviderMetadata, UIMessageChunk } from 'ai'
import * as z from 'zod'
import { ModelStepRetry, type RetryEvent } from './model-step-retry'
import type {
  AgentStep,
  ExecutionJournal,
  ToolExecutionTrace,
  ToolCall,
  ToolExecutionPort
} from './contracts'

const MAX_OUTPUT_TOKEN_RECOVERIES = 1
const OUTPUT_TOKEN_RECOVERY_MESSAGE =
  'Output token limit hit. Resume directly from where you stopped. Do not apologize or recap.'

class OutputTokenLimitError extends Error {}

interface ModelLoopInput {
  provider: ChatProvider
  messages: ChatProviderMessage[]
  registry?: ToolExecutionPort
  thinkingEffort: ThinkingSelection
  signal: AbortSignal
  emit: (chunk: UIMessageChunk) => void
  onStep?: (step: AgentStep) => void
  onToolResult?: (trace: ToolExecutionTrace) => void
  journal?: ExecutionJournal
  prepareStep?: (
    history: readonly ChatProviderMessage[]
  ) => Pick<ChatProviderStreamInput, 'messages' | 'tools'>
  maxAttempts?: number
  retryDelayMs?: number
  onRetry?: (event: RetryEvent) => void
}

const ToolOutputDeltaSchema = z.object({
  toolCallId: z.string().trim().min(1).max(200),
  toolName: z.string().trim().min(1).max(100),
  stream: z.enum(['preview', 'stderr', 'stdout']),
  delta: z
    .string()
    .min(1)
    .max(64 * 1024)
})
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

async function runModelLoop({
  provider,
  messages,
  registry,
  thinkingEffort,
  signal,
  emit,
  onStep,
  onToolResult,
  journal,
  prepareStep = (history) => ({ messages: [...history] }),
  maxAttempts = 5,
  retryDelayMs = 1_000,
  onRetry
}: ModelLoopInput): Promise<void> {
  let history = messages
  const retry = new ModelStepRetry({ maxAttempts, retryDelayMs, onRetry })
  let outputTokenRecoveries = 0
  let responseCount = 0
  for (;;) {
    signal.throwIfAborted()
    // Projection runs once per logical step; retries reuse this exact request.
    const request = { ...prepareStep(history), thinkingEffort, signal }
    const stream = retry.stream(provider, request)
    const invalidResults: ChatProviderToolResultPart[] = []
    const calls: ToolCall[] = []
    const parts: ChatProviderAssistantMessage['parts'] = []
    const reasoningParts = new Map<string, ChatProviderReasoningPart>()
    let finishReason: 'length' | 'stop' | 'tool-calls' | 'unknown' = 'stop'
    let continuation: ChatProviderAssistantMessage['replay']
    let usage: ProviderUsage | undefined
    for await (const chunk of stream) {
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
      if (chunk.type === 'text-delta') appendTextPart(parts, chunk.delta)
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
      emit({ ...chunk, dynamic: true })
    }
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
      if (finishReason !== 'length') return
      if (outputTokenRecoveries >= MAX_OUTPUT_TOKEN_RECOVERIES)
        throw new OutputTokenLimitError(
          'The model reached its output token limit twice. Lower thinking effort or increase the model output limit and try again.'
        )
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
            const parsed = ToolOutputDeltaSchema.safeParse(delta)
            if (!parsed.success) return
            emit({ type: 'data-tool-output-delta', data: parsed.data })
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
    const results = parts.flatMap((part) =>
      part.type === 'tool-call'
        ? [...invalidResults, ...executions.map((execution) => execution.result)].filter(
            (result) => result.toolCallId === part.toolCallId
          )
        : []
    )
    // Facts and history retain complete evidence; prepareStep owns request-only budgets.
    onStep?.({ index: responseCount, assistant: replayAssistant, toolResults: results })
    for (const { result } of executions) emitToolResult(result, emit)
    history = [...history, replayAssistant, { role: 'tool', parts: results }]
  }
}

function appendTextPart(parts: ChatProviderAssistantMessage['parts'], delta: string): void {
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

export { runModelLoop, OutputTokenLimitError, type ModelLoopInput }
