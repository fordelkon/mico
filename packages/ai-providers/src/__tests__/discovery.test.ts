import { describe, expect, it } from 'vitest'

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
  it('lists LM Studio native models with server display names', async () => {
    const client = createFetch(
      jsonResponse({
        models: [
          { key: ' qwen3-8b ', display_name: 'Qwen3 8B' },
          { key: 'qwen3-8b', display_name: 'Duplicate' },
          { key: 42 }
        ]
      })
    )

    await expect(
      discoverModels(
        { provider: 'lm-studio', baseUrl: 'http://localhost:1234/' },
        { fetch: client.fetch }
      )
    ).resolves.toEqual([{ modelId: 'qwen3-8b', displayName: 'Qwen3 8B' }])

    expect(client.request().url).toBe('http://localhost:1234/api/v1/models')
  })

  it('lists Ollama models and ignores malformed rows', async () => {
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
    'lists %s models from the OpenAI model endpoint',
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

  it('lists Anthropic-compatible models with provider display names', async () => {
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

  it('rejects an unsuccessful model-list response', async () => {
    const client = createFetch(new Response(null, { status: 503, statusText: 'Unavailable' }))

    await expect(
      discoverModels(
        { provider: 'ollama', baseUrl: 'http://localhost:11434' },
        { fetch: client.fetch }
      )
    ).rejects.toThrow('Ollama model discovery failed (503 Unavailable).')
  })
})
