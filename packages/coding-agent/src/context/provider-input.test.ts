import type { ChatProviderMessage, ChatProviderToolResultPart } from '@mico/ai-providers'
import { describe, expect, it } from 'vitest'
import { prepareTextInput, prepareTurnInput, ProviderInputLimitExceeded } from './provider-input'

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

describe('summary resource policy', () => {
  function history(output: string): ChatProviderMessage[] {
    return [
      {
        role: 'tool',
        parts: [
          { type: 'tool-result', toolCallId: 'read', toolName: 'Read', output, isError: false }
        ]
      }
    ]
  }

  it('user summarizes a large tool result when input fits, then the summary receives its complete evidence', () => {
    const output = `${'x'.repeat(40 * 1024)}MIDDLE-EVIDENCE${'y'.repeat(40 * 1024)}`
    const request = prepareTextInput({
      purpose: 'summary',
      instructions: 'Summarize.',
      history: history(output),
      signal: new AbortController().signal
    })

    const source = request.messages[1].parts[0]
    expect(source.type === 'text' ? source.text : '').toContain(output)
  })

  it.each([
    { name: 'multibyte evidence', output: '界'.repeat(400_000), instructions: 'Summarize.' },
    {
      name: 'instructions and evidence combined',
      output: 'x'.repeat(600_000),
      instructions: 'x'.repeat(500_000)
    }
  ])(
    'user summarizes oversized $name when it exceeds the byte budget, then request preparation refuses it',
    ({ output, instructions }) => {
      const source = history(output)

      expect(() =>
        prepareTextInput({
          purpose: 'summary',
          instructions,
          history: source,
          signal: new AbortController().signal
        })
      ).toThrow(ProviderInputLimitExceeded)
      expect(source).toEqual(history(output))
    }
  )
})
