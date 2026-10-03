import type { ChatMessage } from '@shared/data/schemas/chat'

import type { AgentDisplayPart } from '../tools/tool-agent-runner'
import type { ToolExecutionTrace } from '../tools/tool-contract'
import { toDisplayToolTrace } from '../sessions/tool-trace-presentation'

const TRUNCATION_MARKER = '…'

/**
 * Owns the turn's visible display: text is capped once for both the live
 * stream and the persisted reply, attributed per stream segment, and the final
 * display parts are assembled from the agent's stream-order sequence and the
 * completed tool traces.
 */
class TurnDisplayAssembler {
  #chunks: string[] = []
  #length = 0
  #sealed = false
  readonly #maxLength: number
  // Visible text attributed per stream segment (text part id) so persistence can
  // rebuild part positions without re-deriving them from the joined string.
  readonly #segments = new Map<string, string[]>()

  constructor(maxLength: number) {
    this.#maxLength = maxLength
  }

  /** The visible portion of one text delta, honoring the shared cap. */
  appendText(delta: string, segmentId?: string): string {
    const visible = this.#appendCapped(delta)
    if (segmentId && visible) {
      const segments = this.#segments.get(segmentId) ?? []
      segments.push(visible)
      this.#segments.set(segmentId, segments)
    }
    return visible
  }

  /**
   * The turn's persisted display parts in exact stream order. An empty
   * assembly falls back to the full visible text.
   */
  buildParts(
    displaySequence: readonly AgentDisplayPart[],
    toolTraces: ReadonlyMap<string, ToolExecutionTrace>
  ): ChatMessage['parts'] {
    const parts: ChatMessage['parts'] = []
    for (const part of displaySequence) {
      if (part.type === 'reasoning') {
        if (part.text) parts.push({ type: 'reasoning', text: part.text })
      } else if (part.type === 'text') {
        const text = this.#visibleSegment(part.textId)
        if (text.trim()) parts.push({ type: 'text', text })
      } else {
        const trace = toolTraces.get(part.toolCallId)
        if (trace) parts.push(toDisplayToolTrace(trace))
      }
    }
    if (!parts.length) parts.push({ type: 'text', text: this.text() })
    return parts
  }

  /** The full visible text streamed so far. */
  text(): string {
    return this.#chunks.join('')
  }

  /** The visible text streamed under one text part id, honoring the shared cap. */
  #visibleSegment(segmentId: string): string {
    return this.#segments.get(segmentId)?.join('') ?? ''
  }

  #appendCapped(delta: string): string {
    if (this.#sealed) return ''

    if (this.#length + delta.length <= this.#maxLength) {
      this.#chunks.push(delta)
      this.#length += delta.length
      if (delta.endsWith(TRUNCATION_MARKER)) this.#sealed = true
      return delta
    }

    const contentLength = Math.max(0, this.#maxLength - TRUNCATION_MARKER.length)
    if (this.#length >= contentLength) {
      const previousLength = this.#length
      this.#truncate(contentLength)
      this.#chunks.push(TRUNCATION_MARKER)
      this.#length += TRUNCATION_MARKER.length
      this.#sealed = true
      return previousLength < this.#length
        ? TRUNCATION_MARKER.slice(previousLength - contentLength)
        : ''
    }

    const remaining = contentLength - this.#length
    const visibleText = delta.slice(0, remaining)
    this.#chunks.push(visibleText, TRUNCATION_MARKER)
    this.#length += visibleText.length + TRUNCATION_MARKER.length
    this.#sealed = true
    return visibleText + TRUNCATION_MARKER
  }

  #truncate(length: number): void {
    while (this.#length > length) {
      const chunk = this.#chunks.at(-1)
      if (chunk === undefined) break

      const excessLength = this.#length - length
      if (chunk.length <= excessLength) {
        this.#chunks.pop()
        this.#length -= chunk.length
      } else {
        this.#chunks[this.#chunks.length - 1] = chunk.slice(0, chunk.length - excessLength)
        this.#length = length
      }
    }
  }
}

export { TurnDisplayAssembler }
