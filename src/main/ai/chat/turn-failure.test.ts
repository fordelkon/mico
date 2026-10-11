import { APICallError } from '@ai-sdk/provider'
import { ProviderError } from '@mico/ai-providers'
import { describe, expect, it } from 'vitest'

import { AgentBudgetError, toTurnFailure } from './turn-failure'

describe('toTurnFailure', () => {
  it.each([401, 403])(
    'user receives structured authentication failure when status is %s, then credentials guidance is shown',
    (status) => {
      expect(toTurnFailure(new ProviderError('http', { status }))).toEqual({
        failure: {
          code: 'provider_error',
          message:
            'Authentication failed for this provider. Check the API key and account permissions.'
        },
        retryable: false
      })
    }
  )
  it('user receives quota failure when billing is exhausted, then no automatic retry occurs', () => {
    expect(toTurnFailure(new ProviderError('quota', { status: 429 })).retryable).toBe(false)
  })
  it('user sees a connection remedy when the fetch fails, then details stay generic', () => {
    expect(toTurnFailure(new TypeError('fetch failed'))).toEqual({
      failure: {
        code: 'provider_error',
        message: "Couldn't connect to the API endpoint. Check the API URL, network, VPN, or proxy."
      },
      retryable: true
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
      failure: {
        code: 'provider_error',
        message:
          'Authentication failed for this provider. Check the API key and account permissions.'
      },
      retryable: false
    })
  })

  it('user sees an unavailable message when the provider returns 503, then retry is offered', () => {
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
      failure: {
        code: 'provider_error',
        message: 'The provider is temporarily unavailable. Please try again shortly.'
      },
      retryable: true
    })
  })

  it('user sees the budget limit when the agent stops itself, then the failure is not retried', () => {
    expect(
      toTurnFailure(
        new AgentBudgetError(
          'step_limit',
          'The agent reached its model step limit before producing a final answer.'
        )
      )
    ).toEqual({
      failure: {
        code: 'step_limit',
        message: 'The agent reached its model step limit before producing a final answer.'
      },
      retryable: false
    })
    expect(
      toTurnFailure(
        new AgentBudgetError(
          'token_limit',
          'The model reached its output token limit twice. Lower thinking effort or increase the model output limit and try again.'
        )
      ).retryable
    ).toBe(false)
  })
})
