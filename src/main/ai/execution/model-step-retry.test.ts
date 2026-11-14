import { type ChatProvider, ProviderError } from '@mico/ai-providers'
import { describe, expect, it, vi } from 'vitest'
import { ModelStepRetry } from './model-step-retry'

const request = {
  messages: [],
  thinkingEffort: 'none' as const,
  signal: new AbortController().signal
}
async function consume(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const chunk of stream) void chunk
}

describe('ModelStepRetry', () => {
  it('user retries successive model steps when transport fails, then the turn budget stays bounded', async () => {
    let calls = 0
    const provider: ChatProvider = {
      getModelCapabilities: async () => null,
      stream: async () => {
        calls += 1
        if (calls !== 2) throw new ProviderError('transport')
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'text-delta' as const, id: 'a', delta: 'ok' }
          }
        }
      }
    }
    const retry = new ModelStepRetry({ maxAttempts: 2, retryDelayMs: 0 })
    await consume(retry.stream(provider, request))
    await expect(consume(retry.stream(provider, request))).rejects.toThrow(/connection|aborted/i)
    expect(calls).toBe(3)
  })

  it('user receives partial output when transport fails, then the step is not regenerated', async () => {
    const stream = vi.fn<ChatProvider['stream']>(async () => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'text-delta' as const, id: 'a', delta: 'partial' }
        throw new ProviderError('transport')
      }
    }))
    await expect(
      consume(
        new ModelStepRetry({ maxAttempts: 3, retryDelayMs: 0 }).stream(
          { stream, getModelCapabilities: async () => null },
          request
        )
      )
    ).rejects.toThrow(/connection|aborted/i)
    expect(stream).toHaveBeenCalledTimes(1)
  })

  it.each([5_000, 120_001])(
    'user receives a server retry deadline when waiting %s milliseconds, then requests never run early',
    async (delay) => {
      vi.useFakeTimers()
      try {
        let calls = 0
        const stream = vi.fn<ChatProvider['stream']>(async () => {
          calls += 1
          if (calls === 1)
            throw new ProviderError('rate_limit', { retryAfterMs: 1, retryAt: Date.now() + delay })
          return {
            async *[Symbol.asyncIterator]() {
              yield* []
            }
          }
        })
        const controller = new AbortController()
        const pending = consume(
          new ModelStepRetry({ maxAttempts: 2, retryDelayMs: 0 }).stream(
            { stream, getModelCapabilities: async () => null },
            { ...request, signal: controller.signal }
          )
        ).catch((error) => error)
        await vi.advanceTimersByTimeAsync(0)
        await vi.advanceTimersByTimeAsync(Math.min(delay - 1, 120_000))
        expect(stream).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(1)
        const result = await pending
        expect(result instanceof Error).toBe(delay > 120_000)
        expect(vi.getTimerCount()).toBe(0)
        expect(stream).toHaveBeenCalledTimes(delay > 120_000 ? 1 : 2)
      } finally {
        vi.useRealTimers()
      }
    }
  )

  it('user cancels during provider backoff when rate limited, then no request follows', async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const stream = vi.fn<ChatProvider['stream']>(async () => {
        throw new ProviderError('rate_limit', { retryAfterMs: 5_000 })
      })
      const onRetry =
        vi.fn<(event: { attempt: number; maxAttempts: number; retryDelayMs: number }) => void>()
      const pending = consume(
        new ModelStepRetry({ maxAttempts: 2, retryDelayMs: 1, onRetry }).stream(
          { stream, getModelCapabilities: async () => null },
          { ...request, signal: controller.signal }
        )
      )
      const rejected = pending.catch((error) => error)
      await vi.advanceTimersByTimeAsync(0)
      expect(onRetry).toHaveBeenCalledWith({ attempt: 2, maxAttempts: 2, retryDelayMs: 5_000 })
      controller.abort()
      expect(await rejected).toBe(controller.signal.reason)
      expect(stream).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
