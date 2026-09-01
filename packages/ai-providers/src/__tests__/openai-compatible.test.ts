import { describe, expect, it, vi } from 'vitest'
import { createChatProvider } from '../index'

async function collect(stream: AsyncIterable<unknown>) {
  const chunks: unknown[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}
describe('OpenAI-compatible provider', () => {
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
})
