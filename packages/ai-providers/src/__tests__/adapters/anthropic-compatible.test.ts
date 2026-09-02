import { describe, expect, it, vi } from 'vitest'
import { createChatProvider } from '../../index'
async function collect(stream: AsyncIterable<unknown>) {
  const chunks: unknown[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}
describe('Anthropic-compatible provider', () => {
  it('finishes normally when a compatible endpoint terminates the stream with [DONE]', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'event: content_block_delta\ndata: {"index":0,"delta":{"type":"text_delta","text":"Done."}}\n\ndata: [DONE]\n\n'
        )
      )
    const provider = createChatProvider(
      {
        provider: 'anthropic-compatible',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'key',
        modelId: 'claude'
      },
      { fetch, createId: () => 'part' }
    )

    await expect(
      collect(
        await provider.stream({
          conversationKey: 'x',
          messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
          thinkingEffort: 'auto',
          signal: new AbortController().signal
        })
      )
    ).resolves.toEqual([
      { type: 'text-start', id: 'part' },
      { type: 'text-delta', id: 'part', delta: 'Done.' },
      { type: 'text-end', id: 'part' }
    ])
  })

  it('ignores Anthropic message metadata after text output', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'event: content_block_delta\ndata: {"index":0,"delta":{"type":"text_delta","text":"Done."}}\n\nevent: message_delta\ndata: {"delta":{"stop_reason":"end_turn"}}\n\nevent: message_stop\ndata: {}\n\n'
        )
      )
    const provider = createChatProvider(
      {
        provider: 'anthropic-compatible',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'key',
        modelId: 'claude'
      },
      { fetch, createId: () => 'part' }
    )

    await expect(
      collect(
        await provider.stream({
          conversationKey: 'x',
          messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
          thinkingEffort: 'auto',
          signal: new AbortController().signal
        })
      )
    ).resolves.toEqual([
      { type: 'text-start', id: 'part' },
      { type: 'text-delta', id: 'part', delta: 'Done.' },
      { type: 'text-end', id: 'part' }
    ])
  })

  it('advertises its built-in thinking control', async () => {
    const provider = createChatProvider({
      provider: 'anthropic-compatible',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'key',
      modelId: 'claude'
    })

    await expect(provider.getModelCapabilities()).resolves.toEqual({
      availability: 'unknown',
      selectableEfforts: ['none', 'low', 'medium', 'high', 'xhigh'],
      defaultEffort: 'medium'
    })
  })

  it('maps a selected thinking effort to an Anthropic token budget', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('event: message_stop\ndata: {}\n\n'))
    const provider = createChatProvider(
      {
        provider: 'anthropic-compatible',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'key',
        modelId: 'claude',
        maxTokens: 8192
      },
      { fetch, createId: () => 'part' }
    )

    await collect(
      await provider.stream({
        conversationKey: 'x',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
        thinkingEffort: 'high',
        signal: new AbortController().signal
      })
    )

    const body = await new Request('https://example.test', fetch.mock.calls[0]?.[1]).json()

    expect(body).toMatchObject({
      max_tokens: 8192,
      thinking: { type: 'enabled', budget_tokens: 6144 }
    })
  })

  it('retries a rejected thinking budget once and remembers the fallback', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('', { status: 422 }))
      .mockResolvedValue(new Response('event: message_stop\ndata: {}\n\n'))
    const provider = createChatProvider(
      {
        provider: 'anthropic-compatible',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'key',
        modelId: 'claude'
      },
      { fetch, createId: () => 'part' }
    )
    const input = {
      conversationKey: 'x',
      messages: [{ role: 'user' as const, parts: [{ type: 'text' as const, text: 'Hi' }] }],
      thinkingEffort: 'high' as const,
      signal: new AbortController().signal
    }

    await collect(await provider.stream(input))
    await collect(await provider.stream(input))

    expect(fetch).toHaveBeenCalledTimes(3)
    expect(
      await new Request('https://example.test', fetch.mock.calls[0]?.[1]).json()
    ).toHaveProperty('thinking')
    expect(
      await new Request('https://example.test', fetch.mock.calls[1]?.[1]).json()
    ).not.toHaveProperty('thinking')
    expect(
      await new Request('https://example.test', fetch.mock.calls[2]?.[1]).json()
    ).not.toHaveProperty('thinking')
  })

  it('does not send the optional disabled thinking configuration', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('event: message_stop\ndata: {}\n\n'))
    const provider = createChatProvider(
      {
        provider: 'anthropic-compatible',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'key',
        modelId: 'claude'
      },
      { fetch, createId: () => 'part' }
    )

    await collect(
      await provider.stream({
        conversationKey: 'x',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
        thinkingEffort: 'none',
        signal: new AbortController().signal
      })
    )

    const body = await new Request('https://example.test', fetch.mock.calls[0]?.[1]).json()

    expect(body).not.toHaveProperty('thinking')
  })

  it('streams thinking and preserves the returned signature as replay metadata', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'event: content_block_start\ndata: {"index":0,"content_block":{"type":"thinking"}}\n\nevent: content_block_delta\ndata: {"index":0,"delta":{"type":"thinking_delta","thinking":"Inspect."}}\n\nevent: content_block_delta\ndata: {"index":0,"delta":{"type":"signature_delta","signature":"sig"}}\n\nevent: content_block_stop\ndata: {"index":0}\n\nevent: content_block_delta\ndata: {"index":1,"delta":{"type":"text_delta","text":"Done."}}\n\nevent: message_stop\ndata: {}\n\n'
        )
      )
    const provider = createChatProvider(
      {
        provider: 'anthropic-compatible',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'key',
        modelId: 'claude'
      },
      { fetch, createId: () => 'part' }
    )
    await expect(
      collect(
        await provider.stream({
          conversationKey: 'x',
          messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
          thinkingEffort: 'auto',
          signal: new AbortController().signal
        })
      )
    ).resolves.toEqual([
      { type: 'reasoning-start', id: 'part' },
      { type: 'reasoning-delta', id: 'part', delta: 'Inspect.' },
      { type: 'reasoning-end', id: 'part', providerMetadata: { anthropic: { signature: 'sig' } } },
      { type: 'text-start', id: 'part' },
      { type: 'text-delta', id: 'part', delta: 'Done.' },
      { type: 'text-end', id: 'part' }
    ])
  })
})
