import { describe, expect, it, vi } from 'vitest'
import { createChatProvider, isProviderFinish, type ProviderStreamPart } from '../../index'

async function collect(stream: AsyncIterable<ProviderStreamPart>) {
  const chunks = []
  for await (const chunk of stream) if (!isProviderFinish(chunk)) chunks.push(chunk)
  return chunks
}
async function collectProtocol(stream: AsyncIterable<ProviderStreamPart>) {
  const chunks: ProviderStreamPart[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}
describe('OpenAI-compatible provider', () => {
  it('maps a length finish reason into the provider protocol envelope', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'
        )
      )
    const provider = createChatProvider(
      { provider: 'openai-compatible', baseUrl: 'https://example.com/v1', modelId: 'model' },
      { fetch, createId: () => 'part' }
    )

    const parts = await collectProtocol(
      await provider.stream({
        conversationKey: 'x',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
        thinkingEffort: 'none',
        signal: new AbortController().signal
      })
    )

    expect(parts).toContainEqual({ type: 'provider-finish', reason: 'length' })
  })

  it('serializes an app-owned tool definition', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('data: [DONE]\n\n'))
    const provider = createChatProvider(
      { provider: 'openai-compatible', baseUrl: 'https://example.com/v1', modelId: 'model' },
      { fetch, createId: () => 'part' }
    )

    await collect(
      await provider.stream({
        conversationKey: 'x',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Read a file.' }] }],
        thinkingEffort: 'none',
        signal: new AbortController().signal,
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

    expect(
      await new Request('https://example.test', fetch.mock.calls[0]?.[1]).json()
    ).toMatchObject({
      tools: [{ type: 'function', function: { name: 'read' } }]
    })
  })

  it('emits a completed tool input from fragmented function arguments', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read","arguments":"{\\"path\\":"}}]}}]}\n\ndata: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.ts\\"}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n'
        )
      )
    const provider = createChatProvider(
      { provider: 'openai-compatible', baseUrl: 'https://example.com/v1', modelId: 'model' },
      { fetch, createId: () => 'part' }
    )

    await expect(
      collect(
        await provider.stream({
          conversationKey: 'x',
          messages: [{ role: 'user', parts: [{ type: 'text', text: 'Read a file.' }] }],
          thinkingEffort: 'none',
          signal: new AbortController().signal
        })
      )
    ).resolves.toEqual([
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

  it('replays assistant calls and tool results with the original call ID', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('data: [DONE]\n\n'))
    const provider = createChatProvider(
      { provider: 'openai-compatible', baseUrl: 'https://example.com/v1', modelId: 'model' },
      { fetch, createId: () => 'part' }
    )

    await collect(
      await provider.stream({
        conversationKey: 'x',
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

  it('rejects a completed call that has no provider call ID', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"read","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n'
        )
      )
    const provider = createChatProvider(
      { provider: 'openai-compatible', baseUrl: 'https://example.com/v1', modelId: 'model' },
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

  it('buffers argument deltas until the call name is available', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"arguments":"{}"}}]}}]}\n\ndata: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"read"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n'
        )
      )
    const provider = createChatProvider(
      { provider: 'openai-compatible', baseUrl: 'https://example.com/v1', modelId: 'model' },
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
    ).resolves.toEqual([
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

  it('marks malformed completed arguments as a tool input error', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read","arguments":"{"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n'
        )
      )
    const provider = createChatProvider(
      { provider: 'openai-compatible', baseUrl: 'https://example.com/v1', modelId: 'model' },
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
      toolCallId: 'call_1',
      toolName: 'read',
      input: '{',
      errorText: 'The OpenAI-compatible provider returned invalid tool arguments.'
    })
  })

  it('rejects a tool call truncated by a natural stream EOF', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read","arguments":"{"}}]}}]}\n\n'
        )
      )
    const provider = createChatProvider(
      { provider: 'openai-compatible', baseUrl: 'https://example.com/v1', modelId: 'model' },
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

  it('appends Chat Completions directly to a versioned API root', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('data: [DONE]\n\n'))
    const provider = createChatProvider(
      {
        provider: 'openai-compatible',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
        modelId: 'model'
      },
      { fetch, createId: () => 'part' }
    )

    await collect(
      await provider.stream({
        conversationKey: 'x',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
        thinkingEffort: 'medium',
        signal: new AbortController().signal
      })
    )

    expect(fetch.mock.calls[0]?.[0]).toBe(
      'https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions'
    )
  })

  it('sends an optimistic reasoning effort and only retries its rejection once', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('', { status: 422 }))
      .mockResolvedValue(new Response('data: [DONE]\n\n'))
    const provider = createChatProvider(
      { provider: 'openai-compatible', baseUrl: 'http://localhost:8000/v1', modelId: 'model' },
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
      reasoning_effort: 'high'
    })
    expect(
      await new Request('https://example.test', fetch.mock.calls[1]?.[1]).json()
    ).not.toHaveProperty('reasoning_effort')
    expect(
      await new Request('https://example.test', fetch.mock.calls[2]?.[1]).json()
    ).not.toHaveProperty('reasoning_effort')
  })

  it('normalizes native reasoning_content separately from answer text', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":{"reasoning_content":"Inspect."}}]}\n\ndata: {"choices":[{"delta":{"content":"Done."}}]}\n\ndata: [DONE]\n\n'
        )
      )
    const provider = createChatProvider(
      { provider: 'openai-compatible', baseUrl: 'http://localhost:8000/v1', modelId: 'model' },
      { fetch, createId: () => 'part' }
    )
    await expect(
      collect(
        await provider.stream({
          conversationKey: 'x',
          messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
          thinkingEffort: 'default',
          signal: new AbortController().signal
        })
      )
    ).resolves.toEqual([
      { type: 'reasoning-start', id: 'part' },
      { type: 'reasoning-delta', id: 'part', delta: 'Inspect.' },
      { type: 'reasoning-end', id: 'part' },
      { type: 'text-start', id: 'part' },
      { type: 'text-delta', id: 'part', delta: 'Done.' },
      { type: 'text-end', id: 'part' }
    ])
  })

  it('streams reasoning when compatible endpoints send null content deltas', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":{"content":null,"reasoning_content":"Inspect."}}]}\n\ndata: {"choices":[{"delta":{"content":"Done."}}]}\n\ndata: [DONE]\n\n'
        )
      )
    const provider = createChatProvider(
      { provider: 'openai-compatible', baseUrl: 'https://example.com/v1', modelId: 'model' },
      { fetch, createId: () => 'part' }
    )

    await expect(
      collect(
        await provider.stream({
          conversationKey: 'x',
          messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
          thinkingEffort: 'none',
          signal: new AbortController().signal
        })
      )
    ).resolves.toEqual([
      { type: 'reasoning-start', id: 'part' },
      { type: 'reasoning-delta', id: 'part', delta: 'Inspect.' },
      { type: 'reasoning-end', id: 'part' },
      { type: 'text-start', id: 'part' },
      { type: 'text-delta', id: 'part', delta: 'Done.' },
      { type: 'text-end', id: 'part' }
    ])
  })

  it('ignores nullable OpenAI-compatible stream containers', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":null}]}\n\ndata: {"choices":null}\n\ndata: {"usage":{"completion_tokens":null}}\n\ndata: [DONE]\n\n'
        )
      )
    const provider = createChatProvider(
      { provider: 'openai-compatible', baseUrl: 'https://example.com/v1', modelId: 'model' },
      { fetch, createId: () => 'part' }
    )

    await expect(
      collect(
        await provider.stream({
          conversationKey: 'x',
          messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
          thinkingEffort: 'none',
          signal: new AbortController().signal
        })
      )
    ).resolves.toEqual([])
  })

  it('does not report null completion token usage as a performance metric', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response('data: {"usage":{"completion_tokens":null}}\n\ndata: [DONE]\n\n')
      )
    let receivedPerformanceMetrics = false
    const provider = createChatProvider(
      { provider: 'openai-compatible', baseUrl: 'https://example.com/v1', modelId: 'model' },
      { fetch, createId: () => 'part' }
    )

    await collect(
      await provider.stream({
        conversationKey: 'x',
        collectPerformanceMetrics: true,
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
        thinkingEffort: 'none',
        signal: new AbortController().signal,
        onPerformanceMetrics: () => {
          receivedPerformanceMetrics = true
        }
      })
    )

    expect(receivedPerformanceMetrics).toBe(false)
  })
})
