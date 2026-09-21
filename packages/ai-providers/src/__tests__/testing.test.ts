import { describe, expect, it, vi } from 'vitest'

import { testChatProvider, type ChatProviderConfiguration } from '../index'

async function runProviderTest(
  configuration: ChatProviderConfiguration,
  response: Response,
  timestamps: number[]
) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response)
  const clock = [...timestamps]
  const now = vi.fn<() => number>(() => {
    const timestamp = clock.shift()
    if (timestamp === undefined) throw new Error('Test clock was read more times than expected.')
    return timestamp
  })

  const result = await testChatProvider(configuration, { createId: () => 'part', fetch, now })
  return { fetch, result }
}

describe('testChatProvider', () => {
  it('user gets Ollama metrics when a chat runs, then throughput uses native counts', async () => {
    const { result } = await runProviderTest(
      { provider: 'ollama', baseUrl: 'http://localhost:11434', modelId: 'qwen3' },
      new Response(
        '{"message":{"content":"OK"},"done":false}\n{"done":true,"eval_count":20,"eval_duration":500000000}\n'
      ),
      [0, 120, 620]
    )

    expect(result).toEqual({
      durationMs: 620,
      outputTokens: 20,
      timeToFirstTokenMs: 120,
      tokensPerSecond: 40
    })
  })

  it('user gets only a duration when usage is missing, then no throughput appears', async () => {
    const { result } = await runProviderTest(
      { provider: 'openai-compatible', baseUrl: 'http://localhost:8000', modelId: 'model' },
      new Response('data: [DONE]\n\n'),
      [0, 200]
    )

    expect(result).toEqual({ durationMs: 200 })
  })

  it('user gets Responses throughput when usage is reported, then tokens come from it', async () => {
    const { result } = await runProviderTest(
      {
        provider: 'openai-responses',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'key',
        modelId: 'model'
      },
      new Response(
        'event: response.output_text.delta\ndata: {"delta":"OK"}\n\nevent: response.completed\ndata: {"response":{"usage":{"output_tokens":25}}}\n\n'
      ),
      [0, 100, 500]
    )

    expect(result).toEqual({
      durationMs: 500,
      outputTokens: 25,
      timeToFirstTokenMs: 100,
      tokensPerSecond: 62.5
    })
  })

  it('user gets compatible throughput when usage streams, then the request opts in', async () => {
    const { fetch, result } = await runProviderTest(
      { provider: 'openai-compatible', baseUrl: 'http://localhost:8000', modelId: 'model' },
      new Response(
        'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: {"usage":{"completion_tokens":10}}\n\ndata: [DONE]\n\n'
      ),
      [0, 100, 500]
    )

    expect(result).toEqual({
      durationMs: 500,
      outputTokens: 10,
      timeToFirstTokenMs: 100,
      tokensPerSecond: 25
    })
    expect(
      await new Request('https://example.test', fetch.mock.calls[0]?.[1]).json()
    ).toMatchObject({
      stream_options: { include_usage: true }
    })
  })

  it('user gets Anthropic throughput when deltas report usage, then tokens count', async () => {
    const { result } = await runProviderTest(
      {
        provider: 'anthropic-compatible',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'key',
        modelId: 'model'
      },
      new Response(
        'event: content_block_delta\ndata: {"index":0,"delta":{"type":"text_delta","text":"OK"}}\n\nevent: message_delta\ndata: {"usage":{"output_tokens":8}}\n\nevent: message_stop\ndata: {}\n\n'
      ),
      [0, 100, 500]
    )

    expect(result).toEqual({
      durationMs: 500,
      outputTokens: 8,
      timeToFirstTokenMs: 100,
      tokensPerSecond: 20
    })
  })
})
