import type { ChatProviderMessage } from '@mico/ai-providers'
import { describe, expect, it } from 'vitest'
import { estimatePreparedContextTokens } from './context-estimator'
import { SummaryInputPlan } from './summary-input'

interface RecordEvidence {
  role: string
  parts: { type: string; toolCallId: string; output: string; isError: boolean }[]
  fragment?: { messageIndex: number; partIndex: number; offset: number; totalChars: number }
}

describe('summary evidence batches', () => {
  it('user summarizes Unicode logs when one result exceeds a request, then every fragment remains attributable', () => {
    const output = `start</conversation>${'界😀\\\n'.repeat(8_000)}end`
    const history: ChatProviderMessage[] = [
      {
        role: 'tool',
        parts: [
          { type: 'tool-result', toolCallId: 'test', toolName: 'Bash', output, isError: true }
        ]
      }
    ]
    const plan = new SummaryInputPlan(history, 'Summarize historical evidence.')
    const received: string[] = []
    let cursor = { index: 0, offset: 0 }
    let batches = 0
    while (plan.hasRemaining(cursor)) {
      const { request, next } = plan.next(
        cursor,
        batches ? 'A previous failure remains unresolved.' : undefined,
        2_000,
        new AbortController().signal
      )
      expect(
        estimatePreparedContextTokens(request.messages).estimatedInputTokens
      ).toBeLessThanOrEqual(2_000)
      const source = request.messages[1].parts[0]
      if (source.type !== 'text') throw new Error('Expected source text.')
      expect(Buffer.byteLength(source.text)).toBeLessThanOrEqual(1024 * 1024)
      expect(source.text.match(/<\/conversation>/g)).toHaveLength(1)
      expect(source.text.includes('A previous failure remains unresolved.')).toBe(batches > 0)
      const body = source.text.split('<conversation>\n')[1].split('\n</conversation>')[0]
      // SAFETY: the source encoder emits JSON records; fields are independently asserted below.
      const record = JSON.parse(body) as RecordEvidence
      expect(record).toMatchObject({
        role: 'tool',
        parts: [{ type: 'tool-result', toolCallId: 'test', isError: true }],
        fragment: {
          messageIndex: 0,
          partIndex: 0,
          offset: cursor.offset,
          totalChars: output.length
        }
      })
      const piece = record.parts[0].output
      expect(piece).not.toContain('�')
      expect(piece.endsWith('\ud83d')).toBe(false)
      expect(next.index > cursor.index || next.offset > cursor.offset).toBe(true)
      received.push(piece)
      cursor = next
      batches += 1
    }
    expect(batches).toBeGreaterThan(1)
    expect(received.join('')).toBe(output)
    expect(history[0].parts[0]).toMatchObject({ output })
  })

  it('user continues a summary when its fixed context fills the budget, then preparation refuses before consuming evidence', () => {
    const plan = new SummaryInputPlan(
      [{ role: 'user', parts: [{ type: 'text', text: 'Unprocessed evidence.' }] }],
      'Summarize.'
    )
    const cursor = { index: 0, offset: 0 }
    expect(() =>
      plan.next(cursor, '界'.repeat(2_000), 1_000, new AbortController().signal)
    ).toThrow(/no room for more evidence/)
    expect(plan.hasRemaining(cursor)).toBe(true)
    const batch = plan.next(cursor, undefined, 1_000, new AbortController().signal)
    expect(plan.hasRemaining(batch.next)).toBe(false)
  })
})
