import { describe, expect, it, vi } from 'vitest'
import { createChatProvider, isProviderFinish, type ProviderStreamPart } from '../../index'
async function collect(stream: AsyncIterable<ProviderStreamPart>) {
  const chunks = []
  for await (const chunk of stream) if (!isProviderFinish(chunk)) chunks.push(chunk)
  return chunks
}
async function collectProtocol(stream: AsyncIterable<ProviderStreamPart>) {
  const parts: ProviderStreamPart[] = []
  for await (const part of stream) parts.push(part)
  return parts
}
describe('Anthropic-compatible provider', () => {
  it('appends Messages directly to an explicitly versioned API root', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('event: message_stop\ndata: {}\n\n'))
    const provider = createChatProvider(
      {
        provider: 'anthropic-compatible',
        baseUrl: 'https://gateway.example.com/proxy/v2',
        apiKey: 'key',
        modelId: 'claude'
      },
      { fetch, createId: () => 'part' }
    )

    await collect(
      await provider.stream({
        conversationKey: 'x',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello.' }] }],
        thinkingEffort: 'none',
        signal: new AbortController().signal
      })
    )

    expect(fetch.mock.calls[0]?.[0]).toBe('https://gateway.example.com/proxy/v2/messages')
  })

  it('maps and streams a tool use through the normalized tool contract', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'event: content_block_start\ndata: {"index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"read","input":{}}}\n\nevent: content_block_delta\ndata: {"index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":"}}\n\nevent: content_block_delta\ndata: {"index":1,"delta":{"type":"input_json_delta","partial_json":"\\"a.ts\\"}"}}\n\nevent: content_block_stop\ndata: {"index":1}\n\nevent: message_stop\ndata: {}\n\n'
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

    const chunks = await collect(
      await provider.stream({
        conversationKey: 'x',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Read.' }] }],
        tools: [
          {
            name: 'read',
            description: 'Read a file.',
            inputSchema: { type: 'object', properties: { path: { type: 'string' } } }
          }
        ],
        thinkingEffort: 'none',
        signal: new AbortController().signal
      })
    )

    expect(
      await new Request('https://example.test', fetch.mock.calls[0]?.[1]).json()
    ).toMatchObject({
      tools: [{ name: 'read', input_schema: { type: 'object' } }]
    })
    expect(chunks).toEqual([
      { type: 'tool-input-start', toolCallId: 'toolu_1', toolName: 'read' },
      { type: 'tool-input-delta', toolCallId: 'toolu_1', inputTextDelta: '{"path":' },
      { type: 'tool-input-delta', toolCallId: 'toolu_1', inputTextDelta: '"a.ts"}' },
      {
        type: 'tool-input-available',
        toolCallId: 'toolu_1',
        toolName: 'read',
        input: { path: 'a.ts' }
      }
    ])
  })

  it('replays tool calls and results as Anthropic content blocks', async () => {
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
        messages: [
          {
            role: 'assistant',
            parts: [
              {
                type: 'tool-call',
                toolCallId: 'toolu_1',
                toolName: 'read',
                argumentsJson: '{"path":"a.ts"}'
              },
              { type: 'text', text: 'Reading now.' }
            ]
          },
          {
            role: 'tool',
            parts: [
              {
                type: 'tool-result',
                toolCallId: 'toolu_1',
                toolName: 'read',
                output: 'not found',
                isError: true
              }
            ]
          }
        ],
        thinkingEffort: 'none',
        signal: new AbortController().signal
      })
    )

    expect(
      await new Request('https://example.test', fetch.mock.calls[0]?.[1]).json()
    ).toMatchObject({
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'read',
              input: { path: 'a.ts' }
            },
            { type: 'text', text: 'Reading now.' }
          ]
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_1', content: 'not found', is_error: true }
          ]
        }
      ]
    })
  })

  it('marks malformed completed input JSON as a tool input error', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'event: content_block_start\ndata: {"index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"read","input":{}}}\n\nevent: content_block_delta\ndata: {"index":0,"delta":{"type":"input_json_delta","partial_json":"{"}}\n\nevent: content_block_stop\ndata: {"index":0}\n\nevent: message_stop\ndata: {}\n\n'
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
          messages: [{ role: 'user', parts: [{ type: 'text', text: 'Read.' }] }],
          thinkingEffort: 'none',
          signal: new AbortController().signal
        })
      )
    ).resolves.toContainEqual({
      type: 'tool-input-error',
      toolCallId: 'toolu_1',
      toolName: 'read',
      input: '{',
      errorText: 'The Anthropic-compatible provider returned invalid tool arguments.'
    })
  })

  it('rejects a completed tool block with no input value or deltas', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'event: content_block_start\ndata: {"index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"read"}}\n\nevent: content_block_stop\ndata: {"index":0}\n\nevent: message_stop\ndata: {}\n\n'
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
          messages: [{ role: 'user', parts: [{ type: 'text', text: 'Read.' }] }],
          thinkingEffort: 'none',
          signal: new AbortController().signal
        })
      )
    ).rejects.toThrow('incomplete tool call')
  })

  it('rejects a tool call truncated by a natural stream EOF', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'event: content_block_start\ndata: {"index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"read","input":{}}}\n\n'
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
          messages: [{ role: 'user', parts: [{ type: 'text', text: 'Read.' }] }],
          thinkingEffort: 'none',
          signal: new AbortController().signal
        })
      )
    ).rejects.toThrow('incomplete tool call')
  })

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

  it('retries a rejected Anthropic API key with bearer authentication', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401, statusText: 'Unauthorized' }))
      .mockResolvedValue(new Response('event: message_stop\ndata: {}\n\n'))
    const provider = createChatProvider(
      {
        provider: 'anthropic-compatible',
        baseUrl: 'https://example.com',
        apiKey: 'provider-key',
        modelId: 'model'
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

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(
      new Request('https://example.test', fetch.mock.calls[0]?.[1]).headers.get('x-api-key')
    ).toBe('provider-key')
    expect(
      new Request('https://example.test', fetch.mock.calls[1]?.[1]).headers.get('authorization')
    ).toBe('Bearer provider-key')
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
      .mockResolvedValueOnce(new Response('', { status: 400 }))
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

    const body = await new Request('https://example.test', fetch.mock.calls[1]?.[1]).json()

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
    ).toMatchObject({
      thinking: { type: 'adaptive' }
    })
    expect(
      await new Request('https://example.test', fetch.mock.calls[1]?.[1]).json()
    ).toMatchObject({
      thinking: { type: 'enabled' }
    })
    expect(
      await new Request('https://example.test', fetch.mock.calls[2]?.[1]).json()
    ).toMatchObject({
      thinking: { type: 'enabled' }
    })
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

  it('marks output-token exhaustion and reserves answer capacity for extra-high thinking', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('', { status: 400 }))
      .mockResolvedValue(
        new Response(
          'event: message_delta\ndata: {"delta":{"stop_reason":"max_tokens"}}\n\nevent: message_stop\ndata: {}\n\n'
        )
      )
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

    const chunks = await collectProtocol(
      await provider.stream({
        conversationKey: 'x',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
        thinkingEffort: 'xhigh',
        signal: new AbortController().signal
      })
    )

    expect(chunks).toContainEqual({ type: 'provider-finish', reason: 'length' })
    const body = await new Request('https://example.test', fetch.mock.calls[1]?.[1]).json()
    expect(body).toMatchObject({ thinking: { type: 'enabled', budget_tokens: 7168 } })
  })

  it('probes adaptive thinking for an unknown Anthropic-compatible model', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('event: message_stop\ndata: {}\n\n'))
    const provider = createChatProvider(
      {
        provider: 'anthropic-compatible',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'key',
        modelId: 'third-party-reasoner'
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
    expect(body).toMatchObject({ thinking: { type: 'adaptive' } })
  })

  it('falls back from rejected adaptive thinking to budget thinking', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('', { status: 400 }))
      .mockResolvedValue(new Response('event: message_stop\ndata: {}\n\n'))
    const provider = createChatProvider(
      {
        provider: 'anthropic-compatible',
        baseUrl: 'https://gateway.example',
        apiKey: 'key',
        modelId: 'third-party-reasoner'
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

    const first = await new Request('https://example.test', fetch.mock.calls[0]?.[1]).json()
    const second = await new Request('https://example.test', fetch.mock.calls[1]?.[1]).json()
    expect(first).toMatchObject({ thinking: { type: 'adaptive' } })
    expect(second).toMatchObject({ thinking: { type: 'enabled', budget_tokens: 6144 } })

    await collect(
      await provider.stream({
        conversationKey: 'y',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Again' }] }],
        thinkingEffort: 'high',
        signal: new AbortController().signal
      })
    )
    const cached = await new Request('https://example.test', fetch.mock.calls[2]?.[1]).json()
    expect(cached).toMatchObject({ thinking: { type: 'enabled', budget_tokens: 6144 } })
  })
})
