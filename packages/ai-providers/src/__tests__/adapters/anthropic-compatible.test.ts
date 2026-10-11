import { describe, expect, it, vi } from 'vitest'

import {
  createChatProvider,
  type ChatProviderConfiguration,
  type ChatProviderStreamInput
} from '../../index'
import {
  collect,
  collectProtocol,
  fetchCallRequestBody,
  readTool,
  streamDependencies
} from '../test-helpers'

type ProviderConfiguration = Extract<
  ChatProviderConfiguration,
  { provider: 'anthropic-compatible' }
>

function providerConfig(overrides: Partial<ProviderConfiguration> = {}): ChatProviderConfiguration {
  return {
    provider: 'anthropic-compatible',
    baseUrl: 'https://api.anthropic.com',
    apiKey: 'key',
    modelId: 'claude',
    ...overrides
  }
}

function streamInput(
  text = 'Hi',
  overrides: Partial<ChatProviderStreamInput> = {}
): ChatProviderStreamInput {
  return {
    messages: [{ role: 'user', parts: [{ type: 'text', text }] }],
    thinkingEffort: 'none',
    signal: new AbortController().signal,
    ...overrides
  }
}

describe('Anthropic-compatible provider', () => {
  it('user sees Messages on a versioned root when streaming starts, then it stays', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => new Response('event: message_stop\ndata: {}\n\n'))
    const provider = createChatProvider(
      providerConfig({ baseUrl: 'https://gateway.example.com/proxy/v2' }),
      streamDependencies(fetch)
    )

    await collect(await provider.stream(streamInput('Hello.')))

    expect(fetch.mock.calls[0]?.[0]).toBe('https://gateway.example.com/proxy/v2/messages')
  })

  it('user sees a streamed tool use when tool blocks are emitted, then input streams', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'event: content_block_start\ndata: {"index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"read","input":{}}}\n\nevent: content_block_delta\ndata: {"index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":"}}\n\nevent: content_block_delta\ndata: {"index":1,"delta":{"type":"input_json_delta","partial_json":"\\"a.ts\\"}"}}\n\nevent: content_block_stop\ndata: {"index":1}\n\nevent: message_stop\ndata: {}\n\n'
        )
      )
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    const chunks = await collect(await provider.stream(streamInput('Read.', { tools: [readTool] })))

    expect(await fetchCallRequestBody(fetch)).toMatchObject({
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

  it('user gets tool history replayed when a chat resumes, then results carry is_error', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => new Response('event: message_stop\ndata: {}\n\n'))
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    await collect(
      await provider.stream(
        streamInput('Hi', {
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
          ]
        })
      )
    )

    expect(await fetchCallRequestBody(fetch)).toMatchObject({
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

  it('user sees a tool input error when JSON is malformed, then the raw input is kept', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'event: content_block_start\ndata: {"index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"read","input":{}}}\n\nevent: content_block_delta\ndata: {"index":0,"delta":{"type":"input_json_delta","partial_json":"{"}}\n\nevent: content_block_stop\ndata: {"index":0}\n\nevent: message_stop\ndata: {}\n\n'
        )
      )
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    await expect(collect(await provider.stream(streamInput('Read.')))).resolves.toContainEqual({
      type: 'tool-input-error',
      toolCallId: 'toolu_1',
      toolName: 'read',
      input: '{',
      errorText: 'The Anthropic-compatible provider returned invalid tool arguments.'
    })
  })

  it('user gets a rejected stream when a tool block is empty, then the error says why', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'event: content_block_start\ndata: {"index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"read"}}\n\nevent: content_block_stop\ndata: {"index":0}\n\nevent: message_stop\ndata: {}\n\n'
        )
      )
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    await expect(collect(await provider.stream(streamInput('Read.')))).rejects.toMatchObject({
      kind: 'incomplete_stream'
    })
  })

  it('user gets a rejected stream when a tool call is cut off, then the error says why', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'event: content_block_start\ndata: {"index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"read","input":{}}}\n\n'
        )
      )
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    await expect(collect(await provider.stream(streamInput('Read.')))).rejects.toMatchObject({
      kind: 'incomplete_stream'
    })
  })

  it('user sees a normal finish when the endpoint sends message_stop, then only text streams', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'event: content_block_delta\ndata: {"index":0,"delta":{"type":"text_delta","text":"Done."}}\n\nevent: message_stop\ndata: {}\n\n'
        )
      )
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    await expect(
      collect(await provider.stream(streamInput('Hi', { thinkingEffort: 'auto' })))
    ).resolves.toEqual([
      { type: 'text-start', id: 'part' },
      { type: 'text-delta', id: 'part', delta: 'Done.' },
      { type: 'text-end', id: 'part' }
    ])
  })

  it('user gets a retried stream when x-api-key is rejected, then bearer auth is used', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401, statusText: 'Unauthorized' }))
      .mockImplementation(async () => new Response('event: message_stop\ndata: {}\n\n'))
    const provider = createChatProvider(
      providerConfig({ baseUrl: 'https://example.com', apiKey: 'provider-key', modelId: 'model' }),
      streamDependencies(fetch)
    )

    await collect(await provider.stream(streamInput()))

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(
      new Request('https://example.test', fetch.mock.calls[0]?.[1]).headers.get('x-api-key')
    ).toBe('provider-key')
    expect(
      new Request('https://example.test', fetch.mock.calls[1]?.[1]).headers.get('authorization')
    ).toBe('Bearer provider-key')
  })

  it('user sees only text output when metadata events follow, then they are ignored', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'event: content_block_delta\ndata: {"index":0,"delta":{"type":"text_delta","text":"Done."}}\n\nevent: message_delta\ndata: {"delta":{"stop_reason":"end_turn"}}\n\nevent: message_stop\ndata: {}\n\n'
        )
      )
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    await expect(
      collect(await provider.stream(streamInput('Hi', { thinkingEffort: 'auto' })))
    ).resolves.toEqual([
      { type: 'text-start', id: 'part' },
      { type: 'text-delta', id: 'part', delta: 'Done.' },
      { type: 'text-end', id: 'part' }
    ])
  })

  it('user sees a thinking control when capabilities load, then efforts are selectable', async () => {
    const provider = createChatProvider(providerConfig())

    await expect(provider.getModelCapabilities()).resolves.toEqual({
      availability: 'unknown',
      selectableEfforts: ['none', 'low', 'medium', 'high', 'xhigh'],
      defaultEffort: 'medium'
    })
  })

  it('user gets no thinking field when thinking is disabled, then the request omits it', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => new Response('event: message_stop\ndata: {}\n\n'))
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    await collect(await provider.stream(streamInput()))

    expect(await fetchCallRequestBody(fetch)).not.toHaveProperty('thinking')
  })

  it('user sees thinking with a signature when one is returned, then it is kept', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'event: content_block_start\ndata: {"index":0,"content_block":{"type":"thinking"}}\n\nevent: content_block_delta\ndata: {"index":0,"delta":{"type":"thinking_delta","thinking":"Inspect."}}\n\nevent: content_block_delta\ndata: {"index":0,"delta":{"type":"signature_delta","signature":"sig"}}\n\nevent: content_block_stop\ndata: {"index":0}\n\nevent: content_block_delta\ndata: {"index":1,"delta":{"type":"text_delta","text":"Done."}}\n\nevent: message_stop\ndata: {}\n\n'
        )
      )
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    await expect(
      collect(await provider.stream(streamInput('Hi', { thinkingEffort: 'auto' })))
    ).resolves.toEqual([
      { type: 'reasoning-start', id: 'part' },
      { type: 'reasoning-delta', id: 'part', delta: 'Inspect.' },
      { type: 'reasoning-end', id: 'part', providerMetadata: { anthropic: { signature: 'sig' } } },
      { type: 'text-start', id: 'part' },
      { type: 'text-delta', id: 'part', delta: 'Done.' },
      { type: 'text-end', id: 'part' }
    ])
  })

  it('user sees a length finish when tokens run out, then xhigh reserves capacity', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('', { status: 400 }))
      .mockResolvedValue(
        new Response(
          'event: message_delta\ndata: {"delta":{"stop_reason":"max_tokens"}}\n\nevent: message_stop\ndata: {}\n\n'
        )
      )
    const provider = createChatProvider(
      providerConfig({ maxTokens: 8192 }),
      streamDependencies(fetch)
    )

    const chunks = await collectProtocol(
      await provider.stream(streamInput('Hi', { thinkingEffort: 'xhigh' }))
    )

    expect(chunks).toContainEqual({ type: 'provider-finish', reason: 'length' })
    expect(await fetchCallRequestBody(fetch, 1)).toMatchObject({
      thinking: { type: 'enabled', budget_tokens: 7168 }
    })
  })

  it('user gets adaptive thinking when a model is unknown, then the request probes it', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => new Response('event: message_stop\ndata: {}\n\n'))
    const provider = createChatProvider(
      providerConfig({ modelId: 'third-party-reasoner' }),
      streamDependencies(fetch)
    )

    await collect(await provider.stream(streamInput('Hi', { thinkingEffort: 'high' })))

    expect(await fetchCallRequestBody(fetch)).toMatchObject({ thinking: { type: 'adaptive' } })
  })

  it.each([400, 422])(
    'user gets budget thinking when adaptive returns %s, then the capped fallback is cached',
    async (status) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(new Response('', { status }))
        .mockImplementation(async () => new Response('event: message_stop\ndata: {}\n\n'))
      const provider = createChatProvider(
        providerConfig({
          baseUrl: 'https://gateway.example',
          modelId: 'third-party-reasoner',
          maxTokens: 8192
        }),
        streamDependencies(fetch)
      )

      await collect(await provider.stream(streamInput('Hi', { thinkingEffort: 'high' })))

      const first = await fetchCallRequestBody(fetch, 0)
      const second = await fetchCallRequestBody(fetch, 1)
      expect(first).toMatchObject({ thinking: { type: 'adaptive' } })
      expect(second).toMatchObject({
        max_tokens: 8192,
        thinking: { type: 'enabled', budget_tokens: 6144 }
      })

      await collect(await provider.stream(streamInput('Again', { thinkingEffort: 'high' })))
      expect(await fetchCallRequestBody(fetch, 2)).toMatchObject({
        max_tokens: 8192,
        thinking: { type: 'enabled', budget_tokens: 6144 }
      })
      expect(fetch).toHaveBeenCalledTimes(3)
    }
  )
})
