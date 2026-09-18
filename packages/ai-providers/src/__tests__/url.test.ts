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
  ])('resolves a versioned API endpoint from %s', (baseUrl, endpoint, expectedUrl) => {
    expect(getVersionedApiUrl(baseUrl, endpoint)).toBe(expectedUrl)
  })

  it('resolves discovery beside a fully specified API endpoint while retaining query parameters', () => {
    expect(
      getVersionedSiblingApiUrl(
        'https://gateway.example.com/proxy/v3/responses?tenant=university',
        'responses',
        'models'
      )
    ).toBe('https://gateway.example.com/proxy/v3/models?tenant=university')
  })

  it('appends native endpoints below a gateway path prefix without a version fallback', () => {
    expect(getNativeApiUrl('https://gateway.example.com/ollama/', 'api/tags')).toBe(
      'https://gateway.example.com/ollama/api/tags'
    )
  })
})
