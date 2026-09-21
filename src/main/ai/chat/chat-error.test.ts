import { APICallError } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import { describeChatError } from './chat-error'

describe('describeChatError', () => {
  it('user sees a connection remedy when the fetch fails, then details stay generic', () => {
    expect(describeChatError(new TypeError('fetch failed'))).toEqual({
      message: "Couldn't connect to the API endpoint. Check the API URL, network, VPN, or proxy.",
      retryable: true
    })
  })

  it('user sees an authentication error when credentials fail, then no secret is exposed', () => {
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

  it('user sees an unavailable message when the provider returns 503, then retry is offered', () => {
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
