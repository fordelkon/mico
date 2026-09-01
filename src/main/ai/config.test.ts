import { describe, expect, it } from 'vitest'

import { readChatConfiguration } from './config'

const baseEnv = {
  MICO_AI_BASE_URL: 'http://localhost:1234',
  MICO_AI_MODEL: 'local-model'
}

describe('readChatConfiguration', () => {
  it('requires an explicit supported provider and only requires an API key for OpenAI', () => {
    expect(() => readChatConfiguration({ isDevelopment: true, env: baseEnv })).toThrow(
      'MICO_AI_PROVIDER'
    )
    expect(
      readChatConfiguration({
        isDevelopment: true,
        env: { ...baseEnv, MICO_AI_PROVIDER: 'lm-studio', MICO_AI_API_KEY: '' }
      })
    ).toMatchObject({ provider: 'lm-studio' })
  })

  it('accepts OpenAI Responses with an API key', () => {
    expect(
      readChatConfiguration({
        isDevelopment: true,
        env: {
          ...baseEnv,
          MICO_AI_PROVIDER: 'openai-responses',
          MICO_AI_API_KEY: 'key'
        }
      })
    ).toEqual({
      provider: 'openai-responses',
      baseUrl: 'http://localhost:1234',
      apiKey: 'key',
      modelId: 'local-model'
    })
  })
})
