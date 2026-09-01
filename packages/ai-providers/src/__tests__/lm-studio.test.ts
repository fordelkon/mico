import { describe, expect, it, vi } from 'vitest'

import { createChatProvider } from '../index'

type ModelsResponse = {
  models: Array<{
    key: string
    capabilities?: { reasoning?: { allowed_options: string[]; default: string } }
  }>
}

function jsonResponse(value: ModelsResponse): Response {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
}

function sseResponse(events: string): Response {
  return new Response(events, { headers: { 'content-type': 'text/event-stream' } })
}

async function collect(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe('LM Studio provider', () => {
  it('maps runtime reasoning options without inventing tiers', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        models: [
          {
            key: 'local-model',
            capabilities: {
              reasoning: { allowed_options: ['off', 'on', 'high'], default: 'on' }
            }
          }
        ]
      })
    )
    const provider = createChatProvider(
      { provider: 'lm-studio', baseUrl: 'http://localhost:1234', modelId: 'local-model' },
      { fetch: fetchMock, createId: () => 'part-1' }
    )

    await expect(provider.getModelCapabilities()).resolves.toEqual({
      availability: 'supported',
      selectableEfforts: ['none', 'auto', 'high'],
      defaultEffort: 'auto'
    })
  })

  it('uses the server-provided xhigh option without inventing tiers', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        models: [
          {
            key: 'qwen/qwen3.8-27b',
            capabilities: {
              reasoning: {
                allowed_options: ['off', 'low', 'medium', 'xhigh', 'on'],
                default: 'xhigh'
              }
            }
          }
        ]
      })
    )
    const provider = createChatProvider(
      {
        provider: 'lm-studio',
        baseUrl: 'http://localhost:1234',
        modelId: 'qwen/qwen3.8-27b'
      },
      { fetch: fetchMock, createId: () => 'part-1' }
    )

    await expect(provider.getModelCapabilities()).resolves.toEqual({
      availability: 'supported',
      selectableEfforts: ['none', 'low', 'medium', 'xhigh', 'auto'],
      defaultEffort: 'xhigh'
    })
  })

  it('offers basic Off and On controls when only the legacy model list is available', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ id: 'legacy-model', capabilities: ['tool_use'] }] }),
          { headers: { 'content-type': 'application/json' } }
        )
      )
    const provider = createChatProvider(
      { provider: 'lm-studio', baseUrl: 'http://localhost:1234', modelId: 'legacy-model' },
      { fetch: fetchMock, createId: () => 'part-1' }
    )

    await expect(provider.getModelCapabilities()).resolves.toEqual({
      availability: 'unknown',
      selectableEfforts: ['none', 'auto'],
      defaultEffort: 'auto'
    })
  })

  it('emits assistant text from LM Studio message content events', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        sseResponse(
          'event: reasoning.delta\ndata: {"delta":"Inspect locally."}\n\nevent: message.delta\ndata: {"type":"message.delta","content":"Hello"}\n\nevent: chat.end\ndata: {"type":"chat.end","result":{}}\n\n'
        )
      )
    const provider = createChatProvider(
      { provider: 'lm-studio', baseUrl: 'http://localhost:1234', modelId: 'local-model' },
      { fetch: fetchMock, createId: () => 'part-1' }
    )

    const chunks = await collect(
      await provider.stream({
        conversationKey: '42:chat-1',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
        thinkingEffort: 'default',
        signal: new AbortController().signal
      })
    )

    expect(chunks).toEqual([
      { type: 'reasoning-start', id: 'part-1' },
      { type: 'reasoning-delta', id: 'part-1', delta: 'Inspect locally.' },
      { type: 'reasoning-end', id: 'part-1' },
      { type: 'text-start', id: 'part-1' },
      { type: 'text-delta', id: 'part-1', delta: 'Hello' },
      { type: 'text-end', id: 'part-1' }
    ])
  })

  it('emits reasoning when LM Studio sends the documented content field', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        sseResponse(
          'event: reasoning.delta\ndata: {"type":"reasoning.delta","content":"Inspect locally."}\n\nevent: message.delta\ndata: {"type":"message.delta","content":"Done."}\n\nevent: chat.end\ndata: {}\n\n'
        )
      )
    const provider = createChatProvider(
      { provider: 'lm-studio', baseUrl: 'http://localhost:1234', modelId: 'local-model' },
      { fetch: fetchMock, createId: () => 'part-1' }
    )

    const chunks = await collect(
      await provider.stream({
        conversationKey: '42:chat-1',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
        thinkingEffort: 'auto',
        signal: new AbortController().signal
      })
    )

    expect(chunks).toEqual([
      { type: 'reasoning-start', id: 'part-1' },
      { type: 'reasoning-delta', id: 'part-1', delta: 'Inspect locally.' },
      { type: 'reasoning-end', id: 'part-1' },
      { type: 'text-start', id: 'part-1' },
      { type: 'text-delta', id: 'part-1', delta: 'Done.' },
      { type: 'text-end', id: 'part-1' }
    ])
  })

  it('continues a conversation with the preceding response ID supplied by application history', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          models: [
            {
              key: 'local-model',
              capabilities: {
                reasoning: { allowed_options: ['off', 'on', 'high'], default: 'on' }
              }
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        sseResponse(
          'event: message.delta\ndata: {"delta":"First response"}\n\nevent: chat.end\ndata: {"response_id":"resp-first"}\n\n'
        )
      )
      .mockResolvedValueOnce(
        sseResponse('event: chat.end\ndata: {"response_id":"resp-second"}\n\n')
      )
    const provider = createChatProvider(
      { provider: 'lm-studio', baseUrl: 'http://localhost:1234', modelId: 'local-model' },
      { fetch: fetchMock, createId: () => 'part-1' }
    )
    const signal = new AbortController().signal

    await provider.getModelCapabilities()
    await collect(
      await provider.stream({
        conversationKey: '42:chat-1',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'First' }] }],
        thinkingEffort: 'high',
        signal
      })
    )
    await collect(
      await provider.stream({
        conversationKey: '42:chat-1',
        messages: [
          { role: 'user', parts: [{ type: 'text', text: 'First' }] },
          {
            role: 'assistant',
            parts: [{ type: 'text', text: 'First response' }],
            providerMetadata: { lmStudio: { responseId: 'resp-first' } }
          },
          { role: 'user', parts: [{ type: 'text', text: 'Second' }] }
        ],
        thinkingEffort: 'default',
        signal
      })
    )

    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({
        model: 'local-model',
        input: 'First',
        stream: true,
        store: true,
        reasoning: 'high'
      })
    )
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(
      JSON.stringify({
        model: 'local-model',
        input: 'Second',
        stream: true,
        store: true,
        previous_response_id: 'resp-first'
      })
    )
  })

  it('throws the server error event without yielding assistant text', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          models: [
            {
              key: 'local-model',
              capabilities: {
                reasoning: { allowed_options: ['off', 'on'], default: 'on' }
              }
            }
          ]
        })
      )
      .mockResolvedValueOnce(sseResponse('event: error\ndata: {"message":"Model failed"}\n\n'))
    const provider = createChatProvider(
      { provider: 'lm-studio', baseUrl: 'http://localhost:1234', modelId: 'local-model' },
      { fetch: fetchMock, createId: () => 'part-1' }
    )

    await provider.getModelCapabilities()
    await expect(
      collect(
        await provider.stream({
          conversationKey: '42:chat-1',
          messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
          thinkingEffort: 'auto',
          signal: new AbortController().signal
        })
      )
    ).rejects.toThrow('Model failed')
  })
})
