import { ModelSelectionError } from './model-selection'
import { APICallError } from '@ai-sdk/provider'
import { ProviderError } from '@mico/ai-providers'
import { describe, expect, it } from 'vitest'

import { OutputTokenLimitError } from '@mico/agent-core'
import { toTurnFailure } from './turn-failure'

describe('toTurnFailure', () => {
  it('user starts with an unavailable model when selection fails, then model guidance is retained', () => {
    expect(
      toTurnFailure(new ModelSelectionError('Restore the original model before retrying.'))
    ).toEqual({
      code: 'no_model',
      message: 'Restore the original model before retrying.'
    })
  })
  it.each([401, 403])(
    'user receives structured authentication failure when status is %s, then credentials guidance is shown',
    (status) => {
      expect(toTurnFailure(new ProviderError('http', { status }))).toEqual({
        code: 'provider_error',
        message:
          'Authentication failed for this provider. Check the API key and account permissions.'
      })
    }
  )
  it('user sees a connection remedy when the fetch fails, then details stay generic', () => {
    expect(toTurnFailure(new TypeError('fetch failed'))).toEqual({
      code: 'provider_error',
      message: "Couldn't connect to the API endpoint. Check the API URL, network, VPN, or proxy."
    })
  })

  it('user sees an authentication error when credentials fail, then no secret is exposed', () => {
    expect(
      toTurnFailure(
        new APICallError({
          message: 'Invalid bearer token',
          url: 'https://api.example.com/v1/chat',
          requestBodyValues: {},
          isRetryable: false,
          statusCode: 401
        })
      )
    ).toEqual({
      code: 'provider_error',
      message: 'Authentication failed for this provider. Check the API key and account permissions.'
    })
  })

  it('user sees an unavailable message when the provider returns 503, then the failure explains the outage', () => {
    expect(
      toTurnFailure(
        new APICallError({
          message: 'Service unavailable',
          url: 'https://api.example.com/v1/chat',
          requestBodyValues: {},
          isRetryable: true,
          statusCode: 503
        })
      )
    ).toEqual({
      code: 'provider_error',
      message: 'The provider is temporarily unavailable. Please try again shortly.'
    })
  })

  it('user reaches the output limit when continuation is exhausted, then the failure records the limit', () => {
    const message = 'The model reached its output token limit twice.'
    expect(toTurnFailure(new OutputTokenLimitError(message))).toEqual({
      code: 'token_limit',
      message
    })
  })
})
