import type { ChatMessage } from '@shared/data/schemas/chat'
import type { UIMessageChunk } from 'ai'
import { toDisplayToolTrace } from './journal/tool-trace-presentation'
import type { ToolExecutionTrace } from '../workspace'

type Chain<T> = { readonly value: T; readonly previous: Chain<T> | undefined }
type DisplayPart = { type: 'text' | 'reasoning'; key: string } | { type: 'tool'; key: string }

const TRUNCATION_MARKER = '…'

/** Owns live and persisted display, including partial output when a turn stops. */
class TurnDisplayAssembler {
  #chunks: Chain<string> | undefined
  #length = 0
  #sealed = false
  readonly #maxLength: number
  #sequence: Chain<DisplayPart> | undefined
  readonly #segments = new Map<string, Chain<string>>()
  readonly #traces = new Map<string, ToolExecutionTrace>()
  readonly #toolPositions = new Map<string, string>()
  #toolCount = 0

  constructor(maxLength: number) {
    this.#maxLength = maxLength
  }

  observeChunk(chunk: UIMessageChunk): UIMessageChunk | null {
    if (chunk.type === 'text-delta') {
      const visible = this.appendText(chunk.delta)
      if (!visible) return null
      this.#appendPart('text', chunk.id, visible)
      return { ...chunk, delta: visible }
    }
    if (chunk.type === 'reasoning-start') {
      this.#appendPart('reasoning', chunk.id, '')
    } else if (chunk.type === 'reasoning-delta') {
      this.#appendPart('reasoning', chunk.id, chunk.delta)
    } else if (chunk.type === 'tool-input-available' || chunk.type === 'tool-input-error') {
      const key = `${++this.#toolCount}:${chunk.toolCallId}`
      this.#toolPositions.set(chunk.toolCallId, key)
      this.#sequence = {
        value: { type: 'tool', key },
        previous: this.#sequence
      }
    }
    return chunk
  }

  recordTrace(trace: ToolExecutionTrace): void {
    const key = this.#toolPositions.get(trace.toolCallId)
    if (key) this.#traces.set(key, trace)
  }

  buildMessage(completionState: 'complete' | 'stopped'): ChatMessage | undefined {
    const parts = ordered(this.#sequence).flatMap<ChatMessage['parts'][number]>((part) => {
      if (part.type === 'tool') {
        const trace = this.#traces.get(part.key)
        return trace ? [toDisplayToolTrace(trace)] : []
      }
      const text = ordered(this.#segments.get(part.key)).join('')
      return text.trim() ? [{ type: part.type, text }] : []
    })
    if (!parts.length && completionState === 'stopped' && !this.text()) return undefined
    return {
      role: 'assistant',
      parts: parts.length ? parts : [{ type: 'text', text: this.text() }],
      metadata: { completionState }
    }
  }

  /** Constant-time accumulation; previously emitted content is never changed. */
  appendText(delta: string): string {
    if (this.#sealed) return ''
    const remaining = this.#maxLength - this.#length
    if (remaining <= 0) {
      this.#sealed = true
      return ''
    }
    const visible =
      delta.length <= remaining
        ? delta
        : delta.slice(0, Math.max(0, remaining - TRUNCATION_MARKER.length)) + TRUNCATION_MARKER
    this.#chunks = { value: visible, previous: this.#chunks }
    this.#length += visible.length
    if (delta.length > remaining) this.#sealed = true
    return visible
  }

  text(): string {
    return ordered(this.#chunks).join('')
  }

  #appendPart(type: 'text' | 'reasoning', id: string, text: string): void {
    const key = `${type}:${id}`
    const previous = this.#segments.get(key)
    if (!previous) this.#sequence = { value: { type, key }, previous: this.#sequence }
    this.#segments.set(key, { value: text, previous })
  }
}

function ordered<T>(head: Chain<T> | undefined): T[] {
  function* values(): Generator<T> {
    for (let node = head; node; node = node.previous) yield node.value
  }
  return Array.from(values()).reverse()
}

export { TurnDisplayAssembler }
