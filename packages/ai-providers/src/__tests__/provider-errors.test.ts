import { describe, expect, it, vi } from 'vitest'

import { createChatProvider, type JsonValue, type ChatProviderConfiguration } from '../index'
import { collectProtocol, streamDependencies } from './test-helpers'

const providers = [
  'openai-compatible',
  'openai-responses',
  'anthropic-compatible',
  'ollama'
] as const

function providerWithResponse(provider: ChatProviderConfiguration['provider'], response: Response) {
  return createChatProvider(
    { provider, baseUrl: 'https://provider.test', modelId: 'model' },
    streamDependencies(vi.fn<typeof fetch>().mockResolvedValue(response))
  )
}

async function consume(provider: ReturnType<typeof createChatProvider>) {
  return collectProtocol(
    await provider.stream({
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
      thinkingEffort: 'none',
      signal: new AbortController().signal
    })
  )
}

function sse(event: string, data: JsonValue) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

const partialStreams = {
  'openai-compatible': sse('message', { choices: [{ delta: { content: 'partial' } }] }),
  'openai-responses': sse('response.output_text.delta', { delta: 'partial' }),
  'anthropic-compatible': sse('content_block_delta', {
    delta: { type: 'text_delta', text: 'partial' }
  }),
  ollama: `${JSON.stringify({ message: { content: 'partial' }, done: false })}\n`
}

const nativeEndings = {
  'openai-compatible': sse('message', { choices: [{ delta: {}, finish_reason: 'stop' }] }),
  'openai-responses': sse('response.completed', { response: { status: 'completed' } }),
  'anthropic-compatible': sse('message_stop', {}),
  ollama: `${JSON.stringify({ done: true })}\n`
}

describe('public provider failures', () => {
  it.each(providers)(
    'user hits %s rate limits when sending, then receives retry timing safely',
    async (provider) => {
      const response = new Response(
        JSON.stringify({ error: { message: 'secret prompt', code: 'rate_limit_exceeded' } }),
        {
          status: 429,
          headers: { 'retry-after': '3' }
        }
      )
      const secondResponse = response.clone()
      await expect(consume(providerWithResponse(provider, response))).rejects.toMatchObject({
        name: 'ProviderError',
        kind: 'rate_limit',
        status: 429,
        retryAfterMs: 3000
      })
      await expect(consume(providerWithResponse(provider, secondResponse))).rejects.not.toThrow(
        'secret prompt'
      )
    }
  )

  it.each(providers)(
    'user loses %s stream before completion when reading, then receives an incomplete error',
    async (provider) => {
      await expect(
        consume(providerWithResponse(provider, new Response(partialStreams[provider])))
      ).rejects.toMatchObject({ name: 'ProviderError', kind: 'incomplete_stream' })
    }
  )

  it.each(providers)(
    'user reaches %s native completion when reading, then receives a successful finish',
    async (provider) => {
      const parts = await consume(
        providerWithResponse(
          provider,
          new Response(partialStreams[provider] + nativeEndings[provider])
        )
      )
      expect(parts.at(-1)).toEqual({ type: 'provider-finish', reason: 'stop' })
    }
  )

  it.each([
    {
      status: 400,
      error: { code: 'context_length_exceeded', message: 'private prompt' },
      kind: 'context_overflow'
    },
    { status: 413, error: { message: 'Payload too large' }, kind: 'http' },
    { status: 400, error: { message: 'Invalid model' }, kind: 'http' },
    {
      status: 400,
      error: {
        type: 'invalid_request_error',
        message: 'prompt is too long: 123 tokens > 100 maximum'
      },
      kind: 'context_overflow'
    },
    { status: 500, error: { message: 'maximum context length exceeded' }, kind: 'http' }
  ])(
    'user receives $status when sending rejected input, then gets $kind classification',
    async ({ status, error, kind }) => {
      await expect(
        consume(
          providerWithResponse(
            'openai-compatible',
            new Response(JSON.stringify({ error }), { status })
          )
        )
      ).rejects.toMatchObject({ kind, status })
    }
  )

  it('user exhausts quota when sending, then the failure is distinct from retryable rate limits', async () => {
    await expect(
      consume(
        providerWithResponse(
          'openai-compatible',
          new Response(JSON.stringify({ error: { code: 'insufficient_quota' } }), { status: 429 })
        )
      )
    ).rejects.toMatchObject({ kind: 'quota', status: 429 })
  })

  it('user exceeds context when using thinking, then no fallback hides the rejection', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: { code: 'context_length_exceeded' } }), {
          status: 400
        })
    )
    const provider = createChatProvider(
      { provider: 'openai-compatible', baseUrl: 'https://provider.test', modelId: 'model' },
      streamDependencies(fetch)
    )
    await expect(
      provider.stream({
        messages: [],
        thinkingEffort: 'high',
        signal: new AbortController().signal
      })
    ).rejects.toMatchObject({ kind: 'context_overflow' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('user receives a dated retry when sending, then keeps its absolute deadline', async () => {
    const retryAt = Date.parse('2099-01-01T00:00:00Z')
    await expect(
      consume(
        providerWithResponse(
          'ollama',
          new Response('busy', {
            status: 503,
            headers: { 'retry-after': new Date(retryAt).toUTCString() }
          })
        )
      )
    ).rejects.toMatchObject({ kind: 'http', status: 503, retryAt })
  })

  it.each([
    new TypeError('fetch failed secret URL'),
    new DOMException('secret URL', 'TimeoutError')
  ])(
    'user loses transport when sending, then receives a safe structured failure',
    async (failure) => {
      const provider = createChatProvider(
        { provider: 'ollama', baseUrl: 'https://provider.test', modelId: 'model' },
        streamDependencies(vi.fn<typeof fetch>().mockRejectedValue(failure))
      )
      await expect(consume(provider)).rejects.toMatchObject({
        name: 'ProviderError',
        kind: 'transport'
      })
      await expect(consume(provider)).rejects.not.toThrow('secret URL')
    }
  )

  it.each(providers)(
    'user receives malformed JSON from %s when reading, then diagnostics hide payload contents',
    async (provider) => {
      const body = provider === 'ollama' ? 'private prompt\n' : 'data: private prompt\n\n'
      await expect(consume(providerWithResponse(provider, new Response(body)))).rejects.not.toThrow(
        'private prompt'
      )
    }
  )

  it('user receives malformed event data when reading, then diagnostics hide payload contents', async () => {
    await expect(
      consume(
        providerWithResponse(
          'openai-compatible',
          new Response(
            sse('message', {
              choices: [{ delta: { content: { secret: 'private prompt' } } }]
            })
          )
        )
      )
    ).rejects.not.toThrow('private prompt')
  })

  it('user receives an explicit stream error when reading, then gets safe provider classification', async () => {
    await expect(
      consume(
        providerWithResponse(
          'openai-responses',
          new Response(
            sse('response.failed', {
              response: { error: { code: 'context_length_exceeded', message: 'secret prompt' } }
            })
          )
        )
      )
    ).rejects.toMatchObject({ kind: 'context_overflow' })
  })

  it.each(['', partialStreams['openai-compatible']])(
    'user receives DONE without a finish reason when reading, then the stream fails',
    async (prefix) => {
      await expect(
        consume(
          providerWithResponse('openai-compatible', new Response(prefix + 'data: [DONE]\n\n'))
        )
      ).rejects.toMatchObject({ kind: 'incomplete_stream' })
    }
  )

  it('user hits Responses output limit during tool input when reading, then can continue without executing partial input', async () => {
    const parts = await consume(
      providerWithResponse(
        'openai-responses',
        new Response(
          sse('response.output_item.added', {
            item: { type: 'function_call', call_id: 'call', name: 'read' }
          }) +
            sse('response.function_call_arguments.delta', { delta: '{"path":' }) +
            sse('response.incomplete', {
              response: {
                id: 'resp',
                incomplete_details: { reason: 'max_output_tokens' },
                usage: { output_tokens: 100 }
              }
            })
        )
      )
    )
    expect(parts.at(-1)).toMatchObject({
      type: 'provider-finish',
      reason: 'length',
      continuation: { provider: 'openai-responses', responseId: 'resp' },
      usage: { outputTokens: 100 }
    })
    expect(parts.filter((part) => part.type === 'tool-input-available')).toEqual([])
  })

  it.each([429, 503])(
    'user receives held-open HTTP %s when sending, then classification is bounded',
    async (status) => {
      vi.useFakeTimers()
      try {
        const cancel = vi.fn<() => void>()
        const response = new Response(new ReadableStream<Uint8Array>({ cancel }), {
          status,
          headers: { 'retry-after': '3' }
        })
        const result = consume(providerWithResponse('ollama', response)).catch(
          (cause: unknown) => cause
        )
        await vi.advanceTimersByTimeAsync(1000)
        expect(await result).toMatchObject({
          status,
          kind: status === 429 ? 'rate_limit' : 'http',
          retryAfterMs: 3000
        })
        expect(cancel).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    }
  )

  it('user receives held-open thinking rejection when sending, then fallback closes the old connection', async () => {
    vi.useFakeTimers()
    try {
      const cancel = vi.fn<() => void>()
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(
          new Response(new ReadableStream<Uint8Array>({ cancel }), { status: 422 })
        )
        .mockResolvedValueOnce(new Response(nativeEndings['openai-compatible']))
      const provider = createChatProvider(
        { provider: 'openai-compatible', baseUrl: 'https://provider.test', modelId: 'model' },
        streamDependencies(fetch)
      )
      const result = provider.stream({
        messages: [],
        thinkingEffort: 'high',
        signal: new AbortController().signal
      })
      await vi.advanceTimersByTimeAsync(1000)
      expect(await collectProtocol(await result)).toContainEqual({
        type: 'provider-finish',
        reason: 'stop'
      })
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('user cancels during thinking rejection inspection when sending, then no fallback request occurs', async () => {
    const controller = new AbortController()
    let started!: () => void
    const reading = new Promise<void>((resolve) => {
      started = resolve
    })
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          pull() {
            started()
          }
        }),
        { status: 400 }
      )
    )
    const provider = createChatProvider(
      { provider: 'openai-compatible', baseUrl: 'https://provider.test', modelId: 'model' },
      streamDependencies(fetch)
    )
    const result = provider
      .stream({
        messages: [],
        thinkingEffort: 'high',
        signal: controller.signal
      })
      .catch((cause: unknown) => cause)
    await reading
    controller.abort()
    expect(await result).toMatchObject({ name: 'AbortError' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each(['openai-responses', 'anthropic-compatible', 'ollama'] as const)(
    'user reaches %s completion before EOF when reading, then the unread connection closes',
    async (provider) => {
      const cancel = vi.fn<() => void>()
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(nativeEndings[provider]))
        },
        cancel
      })
      await consume(providerWithResponse(provider, new Response(body)))
      expect(cancel).toHaveBeenCalledTimes(1)
    }
  )

  it('user retries rejected authentication when sending, then the old response connection closes', async () => {
    const cancel = vi.fn<() => void>()
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(new ReadableStream<Uint8Array>({ cancel }), { status: 401 })
      )
      .mockResolvedValueOnce(new Response(nativeEndings['anthropic-compatible']))
    const provider = createChatProvider(
      {
        provider: 'anthropic-compatible',
        baseUrl: 'https://provider.test',
        modelId: 'model',
        apiKey: 'key'
      },
      streamDependencies(fetch)
    )
    await consume(provider)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('user receives Responses incomplete when reading, then keeps the native length finish', async () => {
    const parts = await consume(
      providerWithResponse(
        'openai-responses',
        new Response(
          sse('response.incomplete', {
            response: { incomplete_details: { reason: 'max_output_tokens' } }
          })
        )
      )
    )
    expect(parts.at(-1)).toEqual({ type: 'provider-finish', reason: 'length' })
  })
})
