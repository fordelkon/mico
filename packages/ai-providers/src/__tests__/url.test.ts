import { describe, expect, it } from 'vitest'

import { getNativeApiUrl, getVersionedApiUrl, getVersionedSiblingApiUrl } from '../url'

describe('provider API URL resolution', () => {
  it.each([
    ['https://api.example.com', 'chat/completions', 'https://api.example.com/v1/chat/completions'],
    [
      'https://gateway.example.com/proxy/v2/',
      'chat/completions',
      'https://gateway.example.com/proxy/v2/chat/completions'
    ],
    [
      'https://gateway.example.com/proxy/v2/chat/completions',
      'chat/completions',
      'https://gateway.example.com/proxy/v2/chat/completions'
    ]
  ])(
    'user gets a versioned endpoint when the base URL is %s, then no version repeats',
    (baseUrl, endpoint, expectedUrl) => {
      expect(getVersionedApiUrl(baseUrl, endpoint)).toBe(expectedUrl)
    }
  )

  it('user gets a sibling endpoint when the URL is complete, then the query is kept', () => {
    expect(
      getVersionedSiblingApiUrl(
        'https://gateway.example.com/proxy/v3/responses?tenant=university',
        'responses',
        'models'
      )
    ).toBe('https://gateway.example.com/proxy/v3/models?tenant=university')
  })

  it('user gets native endpoints when no version applies, then the gateway path holds', () => {
    expect(getNativeApiUrl('https://gateway.example.com/ollama/', 'api/tags')).toBe(
      'https://gateway.example.com/ollama/api/tags'
    )
  })
})
