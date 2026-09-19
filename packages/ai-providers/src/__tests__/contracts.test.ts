import { describe, expect, it } from 'vitest'

import { isProviderFinish, providerFinish } from '../index'

describe('provider protocol envelope', () => {
  it('represents an incomplete Responses stream without becoming a UI chunk', () => {
    const finish = providerFinish({
      reason: 'length',
      continuation: { provider: 'openai-responses', responseId: 'resp_123' },
      usage: { inputTokens: 12, outputTokens: 34, reasoningTokens: 21, totalTokens: 46 }
    })

    expect(isProviderFinish(finish)).toBe(true)
    expect(finish).toEqual({
      type: 'provider-finish',
      reason: 'length',
      continuation: { provider: 'openai-responses', responseId: 'resp_123' },
      usage: { inputTokens: 12, outputTokens: 34, reasoningTokens: 21, totalTokens: 46 }
    })
    expect(isProviderFinish({ type: 'text-delta', id: 'part', delta: 'Hello' })).toBe(false)
  })
})
