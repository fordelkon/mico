import type {
  ChatProviderMessage,
  ChatProviderStreamInput,
  ChatProviderTool,
  ChatProviderToolResultPart,
  ThinkingSelection
} from '@mico/ai-providers'
import type { ContextMeasurement } from '../contracts'
import { estimatePreparedContextTokens } from './context-estimator'

const DEFAULT_TOOL_RESULT_HISTORY_BYTES = 64 * 1024
const TOOL_RESULT_TRUNCATION_MARKER = '\n\n[Tool output shortened for model context.]\n\n'
// Application resource ceiling, not a claim about any provider's context window.
const MAX_SUMMARY_INPUT_BYTES = 1024 * 1024

interface ToolContext {
  definitions: readonly ChatProviderTool[]
  historyBudgets: ReadonlyMap<string, number>
}

interface TurnInput {
  history: readonly ChatProviderMessage[]
  prepareMessages: (history: readonly ChatProviderMessage[]) => ChatProviderMessage[]
  toolContext?: ToolContext
  thinkingEffort: ThinkingSelection
  signal: AbortSignal
}

interface TextInput {
  purpose: 'text'
  instructions: string
  text: string
  signal: AbortSignal
}

interface SummaryInput {
  purpose: 'summary'
  instructions: string
  history: readonly ChatProviderMessage[]
  signal: AbortSignal
}

interface PreparedProviderInput {
  request: ChatProviderStreamInput
  measurement: ContextMeasurement
}

class ProviderInputLimitExceeded extends Error {}

/** Projects accepted values into one request; source lifetimes belong to the caller. */
function prepareTurnInput(input: TurnInput): PreparedProviderInput {
  input.signal.throwIfAborted()
  const history = input.history.map((message) =>
    message.role === 'tool'
      ? { ...message, parts: projectToolResults(message.parts, input.toolContext) }
      : message
  )
  const request: ChatProviderStreamInput = {
    messages: input.prepareMessages(history),
    thinkingEffort: input.thinkingEffort,
    signal: input.signal
  }
  if (input.toolContext) request.tools = input.toolContext.definitions
  return { request, measurement: estimatePreparedContextTokens(request.messages, request.tools) }
}

function prepareTextInput(input: TextInput | SummaryInput): ChatProviderStreamInput {
  input.signal.throwIfAborted()
  const text =
    input.purpose === 'summary'
      ? renderSummarySource(input.history, input.instructions)
      : input.text
  return {
    messages: [
      { role: 'system', parts: [{ type: 'text', text: input.instructions }] },
      { role: 'user', parts: [{ type: 'text', text }] }
    ],
    thinkingEffort: 'none',
    signal: input.signal
  }
}

/** Request-only budgets apply equally to fresh and replayed results; facts stay complete. */
function projectToolResults(
  results: readonly ChatProviderToolResultPart[],
  toolContext?: Pick<ToolContext, 'historyBudgets'>
): ChatProviderToolResultPart[] {
  return results.map((result) => {
    const maxBytes =
      toolContext?.historyBudgets.get(result.toolName) ?? DEFAULT_TOOL_RESULT_HISTORY_BYTES
    if (Buffer.byteLength(result.output) <= maxBytes) return result
    const bytes = Buffer.from(result.output)
    const contentBytes = maxBytes - Buffer.byteLength(TOOL_RESULT_TRUNCATION_MARKER)
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
  })
}

/** Keep all summary evidence or refuse before dispatch; never silently accept a partial source. */
function renderSummarySource(
  messages: readonly ChatProviderMessage[],
  instructions: string
): string {
  const fragments: string[] = []
  let bytes = Buffer.byteLength(instructions)
  const append = (fragment: string): void => {
    bytes += Buffer.byteLength(fragment)
    if (bytes > MAX_SUMMARY_INPUT_BYTES)
      throw new ProviderInputLimitExceeded(
        'The conversation summary input exceeds the 1 MiB application safety limit. The history is unchanged. Start a new conversation with the relevant details to continue.'
      )
    fragments.push(fragment)
  }
  append('<conversation>\n')
  let hasContent = false
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === 'reasoning') continue
      if (hasContent) append('\n')
      hasContent = true
      if (part.type === 'text') {
        append(`${message.role}: `)
        append(part.text)
      } else if (part.type === 'tool-call') {
        append(`${message.role} tool call ${part.toolName}(`)
        append(part.argumentsJson)
        append(')')
      } else {
        append(`tool result for ${part.toolName} (${part.toolCallId}): `)
        append(part.output)
        if (part.isError) append(' [failed]')
      }
    }
  }
  append('\n</conversation>')
  return fragments.join('')
}

export { prepareTurnInput, prepareTextInput, ProviderInputLimitExceeded }
export type { PreparedProviderInput }
