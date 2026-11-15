import type { ChatProviderMessage, ChatProviderStreamInput } from '@mico/ai-providers'
import { estimatePreparedContextTokens } from './context-estimator'
import {
  prepareTextInput,
  ProviderInputLimitExceeded,
  type SummarySourceMessage
} from './provider-input'

const MAX_SUMMARY_SOURCE_BYTES = 8 * 1024 * 1024

type EvidencePart = Exclude<ChatProviderMessage['parts'][number], { type: 'reasoning' }>

interface Evidence {
  role: ChatProviderMessage['role']
  part: EvidencePart
  messageIndex: number
  partIndex: number
}

interface SummaryCursor {
  index: number
  offset: number
}

interface SummaryBatch {
  request: ChatProviderStreamInput
  next: SummaryCursor
}

function content(part: EvidencePart): string {
  if (part.type === 'text') return part.text
  return part.type === 'tool-call' ? part.argumentsJson : part.output
}

function fragment(evidence: Evidence, offset: number, end: number): SummarySourceMessage {
  const { part, role, messageIndex, partIndex } = evidence
  const text = content(part)
  const value = text.slice(offset, end)
  const sliced: EvidencePart =
    part.type === 'text'
      ? { ...part, text: value }
      : part.type === 'tool-call'
        ? { ...part, argumentsJson: value }
        : { ...part, output: value }
  const record = { role, parts: [sliced] }
  return offset || end < text.length
    ? { ...record, fragment: { messageIndex, partIndex, offset, totalChars: text.length } }
    : record
}

/** Text fragments use UTF-16 offsets but never split a Unicode code point. */
function safeEnd(text: string, end: number): number {
  const previous = text.charCodeAt(end - 1)
  const following = text.charCodeAt(end)
  return previous >= 0xd800 && previous <= 0xdbff && following >= 0xdc00 && following <= 0xdfff
    ? end - 1
    : end
}

/** Plans consecutive evidence without consuming it until its summary succeeds. */
class SummaryInputPlan {
  private readonly evidence: Evidence[] = []

  constructor(
    history: readonly ChatProviderMessage[],
    private readonly instructions: string
  ) {
    let bytes = 0
    for (const [messageIndex, message] of history.entries()) {
      for (const [partIndex, part] of message.parts.entries()) {
        if (part.type === 'reasoning') continue
        const record = { role: message.role, part, messageIndex, partIndex }
        bytes += Buffer.byteLength(JSON.stringify(record).replaceAll('<', '\\u003c'))
        if (bytes > MAX_SUMMARY_SOURCE_BYTES)
          throw new ProviderInputLimitExceeded(
            'The conversation summary source exceeds the 8 MiB application safety limit. The history is unchanged. Start a new conversation with the relevant details.'
          )
        this.evidence.push(record)
      }
    }
  }

  hasRemaining(cursor: SummaryCursor): boolean {
    return cursor.index < this.evidence.length
  }

  next(
    cursor: SummaryCursor,
    previousSummary: string | undefined,
    inputBudgetTokens: number,
    signal: AbortSignal
  ): SummaryBatch {
    signal.throwIfAborted()
    const history: SummarySourceMessage[] = []
    const prepare = (candidate: SummarySourceMessage[]): ChatProviderStreamInput | undefined => {
      try {
        const request = prepareTextInput({
          purpose: 'summary',
          instructions: this.instructions,
          history: candidate,
          previousSummary,
          signal
        })
        return estimatePreparedContextTokens(request.messages).estimatedInputTokens <=
          inputBudgetTokens
          ? request
          : undefined
      } catch (error) {
        if (error instanceof ProviderInputLimitExceeded) return undefined
        throw error
      }
    }
    let next = { ...cursor }
    let request: ChatProviderStreamInput | undefined
    while (this.hasRemaining(next)) {
      signal.throwIfAborted()
      const evidence = this.evidence[next.index]
      const text = content(evidence.part)
      const complete = fragment(evidence, next.offset, text.length)
      const prepared = prepare([...history, complete])
      if (prepared) {
        history.push(complete)
        request = prepared
        next = { index: next.index + 1, offset: 0 }
        continue
      }
      if (history.length) break
      // An individual tool result may exceed a whole request. Split its text,
      // retaining call identity, outcome and offsets instead of dropping a middle.
      let low = next.offset + 1
      let high = text.length - 1
      let end = next.offset
      while (low <= high) {
        const middle = Math.floor((low + high) / 2)
        const candidateEnd = safeEnd(text, middle)
        const candidate =
          candidateEnd > next.offset
            ? prepare([fragment(evidence, next.offset, candidateEnd)])
            : undefined
        if (candidate) {
          request = candidate
          end = candidateEnd
          low = middle + 1
        } else if (candidateEnd === next.offset) low = middle + 1
        else high = middle - 1
      }
      if (end === next.offset)
        throw new ProviderInputLimitExceeded(
          'The summary instructions, accumulated checkpoint, or evidence metadata leave no room for more evidence within the input budget. The history is unchanged. Shorten the conversation or use a model with more context.'
        )
      next = { index: next.index, offset: end }
      break
    }
    if (!request)
      throw new ProviderInputLimitExceeded(
        'No summary evidence is available. The history is unchanged.'
      )
    return { request, next }
  }
}

export { SummaryInputPlan }
