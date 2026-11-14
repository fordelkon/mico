import type { ChatProviderToolResultPart } from '@mico/ai-providers'
import { describe, expect, it } from 'vitest'
import { prepareTurnInput } from './provider-input'

describe('tool history projection', () => {
  it('user replays multibyte tool output when the budget splits a character, then both ends stay readable', () => {
    const output = '界'.repeat(40)
    const result: ChatProviderToolResultPart = {
      type: 'tool-result',
      toolCallId: 'read-1',
      toolName: 'Read',
      output,
      isError: false
    }
    const { request } = prepareTurnInput({
      history: [{ role: 'tool', parts: [result] }],
      prepareMessages: (history) => [...history],
      toolContext: { definitions: [], historyBudgets: new Map([['Read', 64]]) },
      thinkingEffort: 'none',
      signal: new AbortController().signal
    })

    expect(request.messages).toMatchObject([
      {
        role: 'tool',
        parts: [
          {
            output: '界界界界\n\n[Tool output shortened for model context.]\n\n界'
          }
        ]
      }
    ])
    expect(result.output).toBe(output)
  })
})
