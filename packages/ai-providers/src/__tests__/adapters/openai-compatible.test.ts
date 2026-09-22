import { describe, expect, it, vi } from 'vitest'

import {
  createChatProvider,
  type ChatProviderConfiguration,
  type ChatProviderStreamInput
} from '../../index'
import { collect, collectProtocol, fetchCallRequestBody, streamDependencies } from '../test-helpers'

type ProviderConfiguration = Extract<ChatProviderConfiguration, { provider: 'openai-compatible' }>

function providerConfig(overrides: Partial<ProviderConfiguration> = {}): ChatProviderConfiguration {
  return {
    provider: 'openai-compatible',
    baseUrl: 'https://example.com/v1',
    modelId: 'model',
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

describe('OpenAI-compatible provider', () => {
  it('user sees a length finish when the endpoint sends one, then it is mapped', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'
        )
      )
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    const parts = await collectProtocol(await provider.stream(streamInput('Hello')))

    expect(parts).toContainEqual({ type: 'provider-finish', reason: 'length' })
  })

  it('user gets the tool definition serialized when tools are sent, then it maps over', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('data: [DONE]\n\n'))
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    await collect(
      await provider.stream(
        streamInput('Read a file.', {
          tools: [
            {
              name: 'read',
              description: 'Read a file.',
              inputSchema: {
                type: 'object',
                properties: { path: { type: 'string' } },
                required: ['path']
              }
            }
          ]
        })
      )
    )

    expect(await fetchCallRequestBody(fetch)).toMatchObject({
      tools: [{ type: 'function', function: { name: 'read' } }]
    })
  })

  it('user sees a completed tool input when arguments fragment, then deltas assemble', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read","arguments":"{\\"path\\":"}}]}}]}\n\ndata: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.ts\\"}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n'
        )
      )
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    await expect(collect(await provider.stream(streamInput('Read a file.')))).resolves.toEqual([
      { type: 'tool-input-start', toolCallId: 'call_1', toolName: 'read' },
      { type: 'tool-input-delta', toolCallId: 'call_1', inputTextDelta: '{"path":' },
      { type: 'tool-input-delta', toolCallId: 'call_1', inputTextDelta: '"a.ts"}' },
      {
        type: 'tool-input-available',
        toolCallId: 'call_1',
        toolName: 'read',
        input: { path: 'a.ts' }
      }
    ])
  })

  it('user gets calls and results replayed when history is resent, then the ID is kept', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('data: [DONE]\n\n'))
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    await collect(
      await provider.stream(
        streamInput('Hi', {
          messages: [
            {
              role: 'assistant',
              parts: [
                { type: 'text', text: 'I will read it.' },
                {
                  type: 'tool-call',
                  toolCallId: 'call_1',
                  toolName: 'read',
                  argumentsJson: '{"path":"a.ts"}'
                }
              ]
            },
            {
              role: 'tool',
              parts: [
                {
                  type: 'tool-result',
                  toolCallId: 'call_1',
                  toolName: 'read',
                  output: 'export {}',
                  isError: false
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
          content: 'I will read it.',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'read', arguments: '{"path":"a.ts"}' }
            }
          ]
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'export {}' }
      ]
    })
  })

  it('user gets a rejected stream when a call has no ID, then the error says why', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"read","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n'
        )
      )
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    await expect(collect(await provider.stream(streamInput('Read.')))).rejects.toThrow(
      'incomplete tool call'
    )
  })

  it('user sees buffered deltas flushed when the call name arrives, then order holds', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"arguments":"{}"}}]}}]}\n\ndata: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"read"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n'
        )
      )
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    await expect(collect(await provider.stream(streamInput('Read.')))).resolves.toEqual([
      { type: 'tool-input-start', toolCallId: 'call_1', toolName: 'read' },
      { type: 'tool-input-delta', toolCallId: 'call_1', inputTextDelta: '{}' },
      {
        type: 'tool-input-available',
        toolCallId: 'call_1',
        toolName: 'read',
        input: {}
      }
    ])
  })

  it('user sees a tool input error when arguments are malformed, then raw input stays', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read","arguments":"{"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n'
        )
      )
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    await expect(collect(await provider.stream(streamInput('Read.')))).resolves.toContainEqual({
      type: 'tool-input-error',
      toolCallId: 'call_1',
      toolName: 'read',
      input: '{',
      errorText: 'The OpenAI-compatible provider returned invalid tool arguments.'
    })
  })

  it('user gets a rejected stream when a call is truncated, then the error says why', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read","arguments":"{"}}]}}]}\n\n'
        )
      )
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    await expect(collect(await provider.stream(streamInput('Read.')))).rejects.toThrow(
      'incomplete tool call'
    )
  })

  it('user sees Chat Completions appended when the root is versioned, then it stays', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('data: [DONE]\n\n'))
    const provider = createChatProvider(
      providerConfig({ baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3' }),
      streamDependencies(fetch)
    )

    await collect(await provider.stream(streamInput('Hi', { thinkingEffort: 'medium' })))

    expect(fetch.mock.calls[0]?.[0]).toBe(
      'https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions'
    )
  })

  it('user gets an optimistic effort when streaming starts, then rejections drop it', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('', { status: 422 }))
      .mockResolvedValue(new Response('data: [DONE]\n\n'))
    const provider = createChatProvider(
      providerConfig({ baseUrl: 'http://localhost:8000/v1' }),
      streamDependencies(fetch)
    )
    const input = streamInput('Hi', { thinkingEffort: 'high' })

    await collect(await provider.stream(input))
    await collect(await provider.stream(input))

    expect(fetch).toHaveBeenCalledTimes(3)
    expect(await fetchCallRequestBody(fetch, 0)).toMatchObject({
      reasoning_effort: 'high'
    })
    expect(await fetchCallRequestBody(fetch, 1)).not.toHaveProperty('reasoning_effort')
    expect(await fetchCallRequestBody(fetch, 2)).not.toHaveProperty('reasoning_effort')
  })

  it('user sees reasoning_content split from text when both stream, then kinds differ', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":{"reasoning_content":"Inspect."}}]}\n\ndata: {"choices":[{"delta":{"content":"Done."}}]}\n\ndata: [DONE]\n\n'
        )
      )
    const provider = createChatProvider(
      providerConfig({ baseUrl: 'http://localhost:8000/v1' }),
      streamDependencies(fetch)
    )

    await expect(
      collect(await provider.stream(streamInput('Hi', { thinkingEffort: 'default' })))
    ).resolves.toEqual([
      { type: 'reasoning-start', id: 'part' },
      { type: 'reasoning-delta', id: 'part', delta: 'Inspect.' },
      { type: 'reasoning-end', id: 'part' },
      { type: 'text-start', id: 'part' },
      { type: 'text-delta', id: 'part', delta: 'Done.' },
      { type: 'text-end', id: 'part' }
    ])
  })

  it('user sees reasoning stream when content is null, then text still follows', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":{"content":null,"reasoning_content":"Inspect."}}]}\n\ndata: {"choices":[{"delta":{"content":"Done."}}]}\n\ndata: [DONE]\n\n'
        )
      )
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    await expect(collect(await provider.stream(streamInput()))).resolves.toEqual([
      { type: 'reasoning-start', id: 'part' },
      { type: 'reasoning-delta', id: 'part', delta: 'Inspect.' },
      { type: 'reasoning-end', id: 'part' },
      { type: 'text-start', id: 'part' },
      { type: 'text-delta', id: 'part', delta: 'Done.' },
      { type: 'text-end', id: 'part' }
    ])
  })

  it('user sees no chunks when stream containers are null, then streaming completes', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":null}]}\n\ndata: {"choices":null}\n\ndata: {"usage":{"completion_tokens":null}}\n\ndata: [DONE]\n\n'
        )
      )
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    await expect(collect(await provider.stream(streamInput()))).resolves.toEqual([])
  })

  it('user gets no metrics when completion usage is null, then no callback fires', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response('data: {"usage":{"completion_tokens":null}}\n\ndata: [DONE]\n\n')
      )
    let receivedPerformanceMetrics = false
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    await collect(
      await provider.stream(
        streamInput('Hi', {
          collectPerformanceMetrics: true,
          onPerformanceMetrics: () => {
            receivedPerformanceMetrics = true
          }
        })
      )
    )

    expect(receivedPerformanceMetrics).toBe(false)
  })

  it('user keeps streaming when reasoning fields arrive as null, then text still follows', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":{"content":"Done.","reasoning_content":null}}]}\n\ndata: [DONE]\n\n'
        )
      )
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    await expect(collect(await provider.stream(streamInput()))).resolves.toEqual([
      { type: 'text-start', id: 'part' },
      { type: 'text-delta', id: 'part', delta: 'Done.' },
      { type: 'text-end', id: 'part' }
    ])
  })

  it('user sees text joined when content streams as parts, then it completes', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":{"content":[{"type":"text","text":"He"},{"type":"text","text":"llo"}]}}]}\n\ndata: [DONE]\n\n'
        )
      )
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    await expect(collect(await provider.stream(streamInput()))).resolves.toEqual([
      { type: 'text-start', id: 'part' },
      { type: 'text-delta', id: 'part', delta: 'Hello' },
      { type: 'text-end', id: 'part' }
    ])
  })

  it('user gets a rejected stream when the endpoint sends an error string, then the message is kept', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('data: {"error":"rate limited"}\n\n'))
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    await expect(collect(await provider.stream(streamInput()))).rejects.toThrow('rate limited')
  })

  it('user sees the tool call assembled when the index is omitted, then it completes', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1","function":{"name":"read","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n'
        )
      )
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    await expect(collect(await provider.stream(streamInput('Read.')))).resolves.toEqual([
      { type: 'tool-input-start', toolCallId: 'call_1', toolName: 'read' },
      { type: 'tool-input-delta', toolCallId: 'call_1', inputTextDelta: '{}' },
      {
        type: 'tool-input-available',
        toolCallId: 'call_1',
        toolName: 'read',
        input: {}
      }
    ])
  })

  it('user gets the failing field in the error when an event is malformed, then it can be diagnosed', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":123}}]}\n\n'))
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    await expect(collect(await provider.stream(streamInput()))).rejects.toThrow(
      'choices.0.delta.content'
    )
  })
})
