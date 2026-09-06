import { describe, expect, it, vi } from 'vitest'

import { testChatProvider } from '../index'

describe('testChatProvider', () => {
  it('returns Ollama native output metrics alongside measured request timing', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          '{"message":{"content":"OK"},"done":false}\n{"done":true,"eval_count":20,"eval_duration":500000000}\n'
        )
      )
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(120).mockReturnValueOnce(620)

    await expect(
      testChatProvider(
        { provider: 'ollama', baseUrl: 'http://localhost:11434', modelId: 'qwen3' },
        { createId: () => 'part', fetch, now }
      )
    ).resolves.toEqual({
      durationMs: 620,
      outputTokens: 20,
      timeToFirstTokenMs: 120,
      tokensPerSecond: 40
    })
  })

  it('returns LM Studio native output metrics alongside measured request timing', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'event: message.delta\ndata: {"delta":"OK"}\n\nevent: chat.end\ndata: {"result":{"stats":{"total_output_tokens":12,"tokens_per_second":30,"time_to_first_token_seconds":0.15}}}\n\n'
        )
      )
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(150).mockReturnValueOnce(550)

    await expect(
      testChatProvider(
        { provider: 'lm-studio', baseUrl: 'http://localhost:1234', modelId: 'local-model' },
        { createId: () => 'part', fetch, now }
      )
    ).resolves.toEqual({
      durationMs: 550,
      outputTokens: 12,
      timeToFirstTokenMs: 150,
      tokensPerSecond: 30
    })
  })

  it('returns duration for a compatible provider that does not report token statistics', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('data: [DONE]\n\n'))
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(200)

    await expect(
      testChatProvider(
        { provider: 'openai-compatible', baseUrl: 'http://localhost:8000', modelId: 'model' },
        { createId: () => 'part', fetch, now }
      )
    ).resolves.toEqual({ durationMs: 200 })
  })

  it('calculates OpenAI Responses throughput from completed-event usage', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'event: response.output_text.delta\ndata: {"delta":"OK"}\n\nevent: response.completed\ndata: {"response":{"usage":{"output_tokens":25}}}\n\n'
        )
      )
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(100).mockReturnValueOnce(500)

    await expect(
      testChatProvider(
        {
          provider: 'openai-responses',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'key',
          modelId: 'model'
        },
        { createId: () => 'part', fetch, now }
      )
    ).resolves.toEqual({
      durationMs: 500,
      outputTokens: 25,
      timeToFirstTokenMs: 100,
      tokensPerSecond: 62.5
    })
  })

  it('calculates OpenAI-compatible throughput from streamed usage', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: {"usage":{"completion_tokens":10}}\n\ndata: [DONE]\n\n'
        )
      )
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(100).mockReturnValueOnce(500)

    await expect(
      testChatProvider(
        { provider: 'openai-compatible', baseUrl: 'http://localhost:8000', modelId: 'model' },
        { createId: () => 'part', fetch, now }
      )
    ).resolves.toEqual({
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

  it('calculates Anthropic-compatible throughput from message usage', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          'event: content_block_delta\ndata: {"index":0,"delta":{"type":"text_delta","text":"OK"}}\n\nevent: message_delta\ndata: {"usage":{"output_tokens":8}}\n\nevent: message_stop\ndata: {}\n\n'
        )
      )
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(100).mockReturnValueOnce(500)

    await expect(
      testChatProvider(
        {
          provider: 'anthropic-compatible',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'key',
          modelId: 'model'
        },
        { createId: () => 'part', fetch, now }
      )
    ).resolves.toEqual({
      durationMs: 500,
      outputTokens: 8,
      timeToFirstTokenMs: 100,
      tokensPerSecond: 20
    })
  })
})
