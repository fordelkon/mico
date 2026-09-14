import { APICallError } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import { describeChatError } from './chat-error'

describe('describeChatError', () => {
  it('gives a connection remedy without exposing the upstream exception', () => {
    expect(describeChatError(new TypeError('fetch failed'))).toEqual({
      message: "Couldn't connect to the API endpoint. Check the API URL, network, VPN, or proxy.",
      retryable: true
    })
  })

  it('explains an authentication failure without exposing credentials', () => {
    expect(
      describeChatError(
        new APICallError({
          message: 'Invalid bearer token',
          url: 'https://api.example.com/v1/chat',
          requestBodyValues: {},
          isRetryable: false,
          statusCode: 401
        })
      )
    ).toEqual({
      message:
        'Authentication failed for this provider. Check the API key and account permissions.',
      retryable: false
    })
  })

  it('identifies a temporarily unavailable provider as retryable', () => {
    expect(
      describeChatError(
        new APICallError({
          message: 'Service unavailable',
          url: 'https://api.example.com/v1/chat',
          requestBodyValues: {},
          isRetryable: true,
          statusCode: 503
        })
      )
    ).toEqual({
      message: 'The provider is temporarily unavailable. Please try again shortly.',
      retryable: true
    })
  })
})
