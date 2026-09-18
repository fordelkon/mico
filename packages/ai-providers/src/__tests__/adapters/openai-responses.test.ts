import { describe, expect, it, vi } from 'vitest'

import { createChatProvider } from '../../index'

function sseResponse(events: string): Response {
  return new Response(events, { headers: { 'content-type': 'text/event-stream' } })
}

async function collect(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe('OpenAI Responses provider', () => {
  it('preserves the no-tool assistant input shape', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(sseResponse('event: response.completed\ndata: {}\n\n'))
    const provider = createChatProvider(
      {
        provider: 'openai-responses',
        baseUrl: 'https://api.openai.com/v1',
        modelId: 'gpt-5.2'
      },
      { fetch: fetchMock, createId: () => 'part' }
    )

    await collect(
      await provider.stream({
        conversationKey: 'x',
        messages: [
          {
            role: 'assistant',
            parts: [
              { type: 'reasoning', text: 'Inspect.' },
              { type: 'text', text: 'Done.' }
            ]
          },
          { role: 'user', parts: [{ type: 'text', text: 'Continue.' }] }
        ],
        thinkingEffort: 'none',
        signal: new AbortController().signal
      })
    )

    expect(
      await new Request('https://example.test', fetchMock.mock.calls[0]?.[1]).json()
    ).toMatchObject({
      input: [
        {
          role: 'assistant',
          content: [
            { type: 'input_text', text: 'Inspect.' },
            { type: 'input_text', text: 'Done.' }
          ]
        },
        { role: 'user', content: [{ type: 'input_text', text: 'Continue.' }] }
      ]
    })
  })

  it('maps tools and assembles multiple calls by output index', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        sseResponse(
          'event: response.output_item.added\ndata: {"output_index":0,"item":{"type":"function_call","call_id":"call_1","name":"read","arguments":""}}\n\nevent: response.function_call_arguments.delta\ndata: {"output_index":0,"delta":"{\\"path\\":\\"a.ts\\"}"}\n\nevent: response.output_item.added\ndata: {"output_index":1,"item":{"type":"function_call","call_id":"call_2","name":"read","arguments":""}}\n\nevent: response.function_call_arguments.delta\ndata: {"output_index":1,"delta":"{\\"path\\":\\"b.ts\\"}"}\n\nevent: response.output_item.done\ndata: {"output_index":0,"item":{"type":"function_call","call_id":"call_1","name":"read","arguments":"{\\"path\\":\\"a.ts\\"}"}}\n\nevent: response.output_item.done\ndata: {"output_index":1,"item":{"type":"function_call","call_id":"call_2","name":"read","arguments":"{\\"path\\":\\"b.ts\\"}"}}\n\nevent: response.completed\ndata: {}\n\n'
        )
      )
    const provider = createChatProvider(
      {
        provider: 'openai-responses',
        baseUrl: 'https://api.openai.com/v1',
        modelId: 'gpt-5.2'
      },
      { fetch: fetchMock, createId: () => 'part' }
    )

    const chunks = await collect(
      await provider.stream({
        conversationKey: 'x',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Read files.' }] }],
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
      await new Request('https://example.test', fetchMock.mock.calls[0]?.[1]).json()
    ).toMatchObject({
      tools: [{ type: 'function', name: 'read' }]
    })
    expect(chunks).toEqual([
      { type: 'tool-input-start', toolCallId: 'call_1', toolName: 'read' },
      {
        type: 'tool-input-delta',
        toolCallId: 'call_1',
        inputTextDelta: '{"path":"a.ts"}'
      },
      { type: 'tool-input-start', toolCallId: 'call_2', toolName: 'read' },
      {
        type: 'tool-input-delta',
        toolCallId: 'call_2',
        inputTextDelta: '{"path":"b.ts"}'
      },
      {
        type: 'tool-input-available',
        toolCallId: 'call_1',
        toolName: 'read',
        input: { path: 'a.ts' }
      },
      {
        type: 'tool-input-available',
        toolCallId: 'call_2',
        toolName: 'read',
        input: { path: 'b.ts' }
      }
    ])
  })

  it('replays completed function calls and outputs as Responses input items', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(sseResponse('event: response.completed\ndata: {}\n\n'))
    const provider = createChatProvider(
      {
        provider: 'openai-responses',
        baseUrl: 'https://api.openai.com/v1',
        modelId: 'gpt-5.2'
      },
      { fetch: fetchMock, createId: () => 'part' }
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
      await new Request('https://example.test', fetchMock.mock.calls[0]?.[1]).json()
    ).toMatchObject({
      input: [
        {
          role: 'assistant',
          content: [{ type: 'input_text', text: 'I will read it.' }]
        },
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'read',
          arguments: '{"path":"a.ts"}'
        },
        { type: 'function_call_output', call_id: 'call_1', output: 'export {}' }
      ]
    })
  })

  it('marks malformed completed function arguments as a tool input error', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        sseResponse(
          'event: response.output_item.added\ndata: {"output_index":0,"item":{"type":"function_call","call_id":"call_1","name":"read","arguments":""}}\n\nevent: response.function_call_arguments.delta\ndata: {"output_index":0,"delta":"{"}\n\nevent: response.output_item.done\ndata: {"output_index":0,"item":{"type":"function_call","call_id":"call_1","name":"read","arguments":"{"}}\n\nevent: response.completed\ndata: {}\n\n'
        )
      )
    const provider = createChatProvider(
      {
        provider: 'openai-responses',
        baseUrl: 'https://api.openai.com/v1',
        modelId: 'gpt-5.2'
      },
      { fetch: fetchMock, createId: () => 'part' }
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
      errorText: 'The OpenAI provider returned invalid tool arguments.'
    })
  })

  it('rejects a terminal incomplete response', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(sseResponse('event: response.incomplete\ndata: {}\n\n'))
    const provider = createChatProvider(
      {
        provider: 'openai-responses',
        baseUrl: 'https://api.openai.com/v1',
        modelId: 'gpt-5.2'
      },
      { fetch: fetchMock, createId: () => 'part' }
    )

    await expect(
      collect(
        await provider.stream({
          conversationKey: 'x',
          messages: [{ role: 'user', parts: [{ type: 'text', text: 'Continue.' }] }],
          thinkingEffort: 'none',
          signal: new AbortController().signal
        })
      )
    ).rejects.toThrow('incomplete response')
  })

  it('appends Responses directly to a versioned API root', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(sseResponse('event: response.completed\ndata: {}\n\n'))
    const provider = createChatProvider(
      {
        provider: 'openai-responses',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        apiKey: 'key',
        modelId: 'model'
      },
      { fetch: fetchMock, createId: () => 'part-1' }
    )

    await collect(
      await provider.stream({
        conversationKey: 'x',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
        thinkingEffort: 'medium',
        signal: new AbortController().signal
      })
    )

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://ark.cn-beijing.volces.com/api/v3/responses')
  })

  it('streams visible reasoning summaries separately from answer text', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        sseResponse(
          'event: response.reasoning_summary_text.delta\ndata: {"delta":"Inspect the request."}\n\nevent: response.output_text.delta\ndata: {"delta":"Done."}\n\nevent: response.completed\ndata: {}\n\n'
        )
      )
    const provider = createChatProvider(
      {
        provider: 'openai-responses',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'key',
        modelId: 'gpt-5.2'
      },
      { fetch: fetchMock, createId: () => 'part-1' }
    )

    const chunks = await collect(
      await provider.stream({
        conversationKey: '42:chat-1',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
        thinkingEffort: 'high',
        signal: new AbortController().signal
      })
    )

    const body = await new Request('https://example.test', fetchMock.mock.calls[0]?.[1]).text()
    expect(JSON.parse(body)).toMatchObject({
      reasoning: { effort: 'high', summary: 'auto' }
    })
    expect(chunks).toEqual([
      { type: 'reasoning-start', id: 'part-1' },
      { type: 'reasoning-delta', id: 'part-1', delta: 'Inspect the request.' },
      { type: 'reasoning-end', id: 'part-1' },
      { type: 'text-start', id: 'part-1' },
      { type: 'text-delta', id: 'part-1', delta: 'Done.' },
      { type: 'text-end', id: 'part-1' }
    ])
  })

  it('sends a Responses request with the documented selected effort', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        sseResponse(
          'event: response.output_text.delta\ndata: {"delta":"Hello"}\n\nevent: response.completed\ndata: {}\n\n'
        )
      )
    const provider = createChatProvider(
      {
        provider: 'openai-responses',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'key',
        modelId: 'gpt-5.2'
      },
      { fetch: fetchMock, createId: () => 'part-1' }
    )

    const chunks = await collect(
      await provider.stream({
        conversationKey: '42:chat-1',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
        thinkingEffort: 'xhigh',
        signal: new AbortController().signal
      })
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/responses',
      expect.objectContaining({ method: 'POST' })
    )
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      'Bearer key'
    )
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('content-type')).toBe(
      'application/json'
    )
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        model: 'gpt-5.2',
        stream: true,
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }],
        reasoning: { effort: 'xhigh', summary: 'auto' }
      })
    )
    expect(chunks).toEqual([
      { type: 'text-start', id: 'part-1' },
      { type: 'text-delta', id: 'part-1', delta: 'Hello' },
      { type: 'text-end', id: 'part-1' }
    ])
  })

  it('optimistically sends an effort for an unknown model', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(sseResponse('event: response.completed\ndata: {}\n\n'))
    const provider = createChatProvider(
      {
        provider: 'openai-responses',
        baseUrl: 'https://api.openai.com',
        apiKey: 'key',
        modelId: 'gpt-5.1'
      },
      { fetch: fetchMock, createId: () => 'part-1' }
    )

    await collect(
      await provider.stream({
        conversationKey: '42:chat-1',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
        thinkingEffort: 'xhigh',
        signal: new AbortController().signal
      })
    )

    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        model: 'gpt-5.1',
        stream: true,
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }],
        reasoning: { effort: 'xhigh', summary: 'auto' }
      })
    )
  })

  it('retries a rejected effort once and remembers the fallback', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 400 }))
      .mockResolvedValue(new Response('event: response.completed\ndata: {}\n\n'))
    const provider = createChatProvider(
      {
        provider: 'openai-responses',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'key',
        modelId: 'model'
      },
      { fetch: fetchMock, createId: () => 'part-1' }
    )
    const input = {
      conversationKey: '42:chat-1',
      messages: [{ role: 'user' as const, parts: [{ type: 'text' as const, text: 'Hello' }] }],
      thinkingEffort: 'high' as const,
      signal: new AbortController().signal
    }

    await collect(await provider.stream(input))
    await collect(await provider.stream(input))

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(
      await new Request('https://example.test', fetchMock.mock.calls[0]?.[1]).json()
    ).toMatchObject({
      reasoning: { effort: 'high' }
    })
    expect(
      await new Request('https://example.test', fetchMock.mock.calls[1]?.[1]).json()
    ).not.toHaveProperty('reasoning')
    expect(
      await new Request('https://example.test', fetchMock.mock.calls[2]?.[1]).json()
    ).not.toHaveProperty('reasoning')
  })
})
