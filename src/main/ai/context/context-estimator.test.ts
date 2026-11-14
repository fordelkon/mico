import type { ChatProviderMessage, ChatProviderTool } from '@mico/ai-providers'
import { describe, expect, it } from 'vitest'
import { estimatePreparedContextTokens } from './context-estimator'

function userMessage(text: string): ChatProviderMessage {
  return { role: 'user', parts: [{ type: 'text', text }] }
}

describe('estimatePreparedContextTokens', () => {
  const tool: ChatProviderTool = {
    name: 'Bash',
    description: 'Run a command',
    inputSchema: { type: 'object', properties: { command: { type: 'string' } } }
  }

  it('user measures a request when one message is prepared, then the heuristic yields its documented literal sum', () => {
    // Heuristic: 4 ASCII codepoints per token; 1 token per non-ASCII codepoint.
    // role 'user' (4 ASCII → 1) + text 'abcd' (4 ASCII → 1) = 2.
    const estimate = estimatePreparedContextTokens([userMessage('abcd')])

    expect(estimate).toEqual({
      policyId: 'unicode-heuristic-v1',
      estimatedInputTokens: 2
    })
  })

  it('user sends non-ASCII text when measuring, then codepoints weigh more than ASCII', () => {
    // role 'user' (1) + 4 non-ASCII codepoints at one token each = 5.
    const nonAscii = estimatePreparedContextTokens([userMessage('你好世界')])
    const ascii = estimatePreparedContextTokens([userMessage('abcd')])

    expect(nonAscii.estimatedInputTokens).toBe(5)
    expect(nonAscii.estimatedInputTokens).toBeGreaterThan(ascii.estimatedInputTokens)
  })

  it('user counts every prepared part when a turn spans roles, then reasoning, calls, and results are included', () => {
    // Heuristic per part, in order:
    // 'system' 6 ASCII → 2, text '12345678' → 2; 'assistant' 9 ASCII → 3,
    // reasoning 'abcd' → 1, toolName 'Bash' → 1, argumentsJson (7 ASCII) → 2;
    // 'tool' → 1, toolName 'Bash' → 1, output 'abcd' → 1. Total 14.
    const estimate = estimatePreparedContextTokens([
      { role: 'system', parts: [{ type: 'text', text: '12345678' }] },
      {
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'abcd' },
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'Bash',
            argumentsJson: '{"a":1}'
          }
        ]
      },
      {
        role: 'tool',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'Bash',
            output: 'abcd',
            isError: false
          }
        ]
      }
    ])

    expect(estimate.estimatedInputTokens).toBe(14)
  })

  it('user includes tool definitions when tools are prepared, then the count grows and stays deterministic', () => {
    const messages = [userMessage('read the project')]

    const withoutTools = estimatePreparedContextTokens(messages)
    const withTools = estimatePreparedContextTokens(messages, [tool])
    const repeat = estimatePreparedContextTokens(messages, [tool])

    expect(withTools.estimatedInputTokens).toBeGreaterThan(withoutTools.estimatedInputTokens)
    expect(repeat).toEqual(withTools)
  })

  it('user measures a tool schema when it is deeply nested, then the traversal stays bounded', () => {
    let schema: ChatProviderTool['inputSchema'] = { type: 'string' }
    for (let depth = 0; depth < 2_000; depth += 1)
      schema = { type: 'object', properties: { a: schema } }

    expect(() =>
      estimatePreparedContextTokens(
        [userMessage('hello')],
        [{ name: 'Deep', description: 'd', inputSchema: schema }]
      )
    ).not.toThrow()
  })
})
