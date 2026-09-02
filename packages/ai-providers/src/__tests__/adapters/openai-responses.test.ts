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
      expect.objectContaining({
        method: 'POST',
        headers: { authorization: 'Bearer key', 'content-type': 'application/json' }
      })
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
