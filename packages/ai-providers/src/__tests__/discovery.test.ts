import { describe, expect, it, vi } from 'vitest'

import { discoverModels } from '../discovery'

type RecordingFetch = {
  fetch: typeof globalThis.fetch
  request: () => Request
}
type ModelListFixture = {
  data?: Array<{ id?: string; display_name?: string }>
  models?: Array<{ display_name?: string; key?: number | string; name?: string }>
}

function jsonResponse(value: ModelListFixture): Response {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
}

function createFetch(response: Response): RecordingFetch {
  let request: Request | undefined

  return {
    fetch: async (input, init) => {
      request = new Request(input, init)
      return response
    },
    request: () => {
      if (!request) throw new Error('Expected model discovery to make a request.')
      return request
    }
  }
}

describe('discoverModels', () => {
  it('user sees only valid Ollama models when rows are malformed, then bad rows drop', async () => {
    const client = createFetch(
      jsonResponse({ models: [{ name: 'llama3.2:latest' }, {}, { name: ' ' }] })
    )

    await expect(
      discoverModels(
        { provider: 'ollama', baseUrl: 'http://localhost:11434/' },
        { fetch: client.fetch }
      )
    ).resolves.toEqual([{ modelId: 'llama3.2:latest', displayName: 'llama3.2:latest' }])

    expect(client.request().url).toBe('http://localhost:11434/api/tags')
  })

  it.each(['openai-responses', 'openai-compatible'] as const)(
    'user sees %s models when listing from OpenAI, then the request is authorized',
    async (provider) => {
      const client = createFetch(jsonResponse({ data: [{ id: 'gpt-5.6' }] }))

      await expect(
        discoverModels(
          { provider, baseUrl: 'https://example.com', apiKey: 'secret-key' },
          { fetch: client.fetch }
        )
      ).resolves.toEqual([{ modelId: 'gpt-5.6', displayName: 'gpt-5.6' }])

      expect(client.request().url).toBe('https://example.com/v1/models')
      expect(client.request().headers.get('authorization')).toBe('Bearer secret-key')
    }
  )

  it('user sees Anthropic display names when listing models, then x-api-key is used', async () => {
    const client = createFetch(
      jsonResponse({ data: [{ id: 'claude-sonnet', display_name: 'Claude Sonnet' }] })
    )

    await expect(
      discoverModels(
        {
          provider: 'anthropic-compatible',
          baseUrl: 'https://example.com/v1/messages',
          apiKey: 'anthropic-key'
        },
        { fetch: client.fetch }
      )
    ).resolves.toEqual([{ modelId: 'claude-sonnet', displayName: 'Claude Sonnet' }])

    expect(client.request().url).toBe('https://example.com/v1/models')
    expect(client.request().headers.get('x-api-key')).toBe('anthropic-key')
    expect(client.request().headers.get('anthropic-version')).toBe('2023-06-01')
  })

  it('user keeps a custom version root when listing models, then /models is appended', async () => {
    const client = createFetch(jsonResponse({ data: [{ id: 'claude-sonnet' }] }))

    await expect(
      discoverModels(
        {
          provider: 'anthropic-compatible',
          baseUrl: 'https://gateway.example.com/proxy/v2',
          apiKey: 'anthropic-key'
        },
        { fetch: client.fetch }
      )
    ).resolves.toEqual([{ modelId: 'claude-sonnet', displayName: 'claude-sonnet' }])

    expect(client.request().url).toBe('https://gateway.example.com/proxy/v2/models')
  })

  it('user gets models when x-api-key is rejected, then discovery retries bearer auth', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401, statusText: 'Unauthorized' }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'ark-code-latest' }] }))

    await expect(
      discoverModels(
        {
          provider: 'anthropic-compatible',
          baseUrl: 'https://example.com/v1/messages',
          apiKey: 'provider-key'
        },
        { fetch }
      )
    ).resolves.toEqual([{ modelId: 'ark-code-latest', displayName: 'ark-code-latest' }])

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(
      new Request('https://example.test', fetch.mock.calls[0]?.[1]).headers.get('x-api-key')
    ).toBe('provider-key')
    expect(
      new Request('https://example.test', fetch.mock.calls[1]?.[1]).headers.get('authorization')
    ).toBe('Bearer provider-key')
  })

  it('user gets a discovery error when the list fails, then the status is reported', async () => {
    const client = createFetch(new Response(null, { status: 503, statusText: 'Unavailable' }))

    await expect(
      discoverModels(
        { provider: 'ollama', baseUrl: 'http://localhost:11434' },
        { fetch: client.fetch }
      )
    ).rejects.toThrow('Ollama model discovery failed (503 Unavailable).')
  })
})
