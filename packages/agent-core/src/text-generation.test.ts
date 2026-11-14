import {
  type ChatProvider,
  type ChatProviderStreamInput,
  type ProviderStreamPart,
  providerFinish
} from '@mico/ai-providers'
import { describe, expect, it } from 'vitest'
import { TextGeneration, TextGenerationRejected } from './index'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function providerFrom(stream: ChatProvider['stream']): ChatProvider {
  return { getModelCapabilities: () => Promise.resolve(null), stream }
}

function streamFrom(
  parts: ProviderStreamPart[],
  onClose: () => void = () => {}
): AsyncIterable<ProviderStreamPart> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<ProviderStreamPart> {
      try {
        yield* parts
      } finally {
        onClose()
      }
    }
  }
}

function text(delta: string): ProviderStreamPart {
  return { type: 'text-delta', id: 'text', delta }
}

function input(signal: AbortSignal = new AbortController().signal): ChatProviderStreamInput {
  return {
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'Generate plain text.' }] }],
    thinkingEffort: 'none',
    signal
  }
}

const stop = providerFinish({ reason: 'stop' })

const rejectedResponses: { scenario: string; parts: ProviderStreamPart[]; message: string }[] = [
  { scenario: 'a stream has no finish', parts: [text('Draft')], message: 'without completing' },
  {
    scenario: 'a model hits its limit',
    parts: [text('Draft'), providerFinish({ reason: 'length' })],
    message: 'early (length)'
  },
  {
    scenario: 'a model filters its answer',
    parts: [text('Draft'), providerFinish({ reason: 'content-filter' })],
    message: 'early (content-filter)'
  },
  {
    scenario: 'a model cancels its answer',
    parts: [text('Draft'), providerFinish({ reason: 'cancelled' })],
    message: 'early (cancelled)'
  },
  {
    scenario: 'a model finishes ambiguously',
    parts: [text('Draft'), providerFinish({ reason: 'unknown' })],
    message: 'early (unknown)'
  },
  {
    scenario: 'a model requests tools',
    parts: [text('Draft'), providerFinish({ reason: 'tool-calls' })],
    message: 'tried to run tools'
  },
  {
    scenario: 'a model emits a tool after stop',
    parts: [
      text('Draft'),
      stop,
      { type: 'tool-input-start', toolCallId: 'call', toolName: 'Read' }
    ],
    message: 'tried to run tools'
  },
  {
    scenario: 'a model emits only thinking',
    parts: [text('<think>Hidden</think>  '), stop],
    message: 'empty text'
  }
]

describe('TextGeneration', () => {
  it('user receives text when the combined budget is met, then thinking is removed', async () => {
    const runner = new TextGeneration()
    const provider = providerFrom(async () =>
      streamFrom([{ type: 'reasoning-delta', id: 'reasoning', delta: 'why' }, text(' ok'), stop])
    )
    await expect(runner.generate({ provider, request: input(), maxOutputChars: 6 })).resolves.toBe(
      'ok'
    )
  })

  it.each(rejectedResponses)(
    'user receives no text when $scenario, then the response is rejected',
    async ({ parts, message }) => {
      const runner = new TextGeneration()
      const provider = providerFrom(async () => streamFrom(parts))
      const result = runner.generate({ provider, request: input(), maxOutputChars: 100 })
      await expect(result).rejects.toThrow(TextGenerationRejected)
      await expect(result).rejects.toThrow(message)
    }
  )

  it('user exceeds the budget when reasoning and text add up, then the stream closes', async () => {
    let closed = false
    const runner = new TextGeneration()
    const provider = providerFrom(async () =>
      streamFrom(
        [{ type: 'reasoning-delta', id: 'reasoning', delta: '1234' }, text('abc'), stop],
        () => {
          closed = true
        }
      )
    )
    await expect(
      runner.generate({ provider, request: input(), maxOutputChars: 6 })
    ).rejects.toThrow('maximum length of 6 characters')
    expect(closed).toBe(true)
  })

  it('user receives excessive stream parts when text stays small, then the stream closes', async () => {
    let closed = false
    const runner = new TextGeneration()
    const provider = providerFrom(async () => ({
      async *[Symbol.asyncIterator](): AsyncIterator<ProviderStreamPart> {
        try {
          for (let index = 0; index < 100_001; index += 1) yield stop
        } finally {
          closed = true
        }
      }
    }))
    await expect(
      runner.generate({ provider, request: input(), maxOutputChars: 6 })
    ).rejects.toThrow('resource limit')
    expect(closed).toBe(true)
  })

  it('user starts with an aborted request when generating, then no provider call starts', async () => {
    const parent = new AbortController()
    const reason = new Error('Cancelled before starting')
    parent.abort(reason)
    let called = false
    const provider = providerFrom(async () => {
      called = true
      return streamFrom([text('Ignored'), stop])
    })
    const runner = new TextGeneration()
    await expect(
      runner.generate({ provider, request: input(parent.signal), maxOutputChars: 100 })
    ).rejects.toBe(reason)
    expect(called).toBe(false)
    await runner.drain()
  })

  it('user cancels during acquisition when a stream arrives late, then it closes before drain', async () => {
    const parent = new AbortController()
    const reason = new Error('Parent cancelled')
    const acquired = deferred<AsyncIterable<ProviderStreamPart>>()
    let providerSignal: AbortSignal | undefined
    let closed = false
    const provider = providerFrom(async (request) => {
      providerSignal = request.signal
      return acquired.promise
    })
    const runner = new TextGeneration()
    const result = runner.generate({ provider, request: input(parent.signal), maxOutputChars: 100 })
    const rejected = result.catch((error: Error) => error)
    let drained = false
    const draining = runner.drain().then(() => {
      drained = true
    })
    parent.abort(reason)
    expect(providerSignal).not.toBe(parent.signal)
    expect(providerSignal?.aborted).toBe(true)
    await Promise.resolve()
    expect(drained).toBe(false)
    acquired.resolve({
      [Symbol.asyncIterator](): AsyncIterator<ProviderStreamPart> {
        return {
          next: async () => ({ done: true, value: undefined }),
          return: async () => {
            closed = true
            return { done: true, value: undefined }
          }
        }
      }
    })
    await expect(rejected).resolves.toBe(reason)
    await draining
    expect(closed).toBe(true)
    expect(drained).toBe(true)
  })

  it('user cancels while reading when a provider still emits text, then the stream closes', async () => {
    const parent = new AbortController()
    const reason = new Error('Cancelled while streaming')
    let closed = false
    const provider = providerFrom(async () => ({
      async *[Symbol.asyncIterator](): AsyncIterator<ProviderStreamPart> {
        try {
          yield text('Draft')
          parent.abort(reason)
          yield stop
        } finally {
          closed = true
        }
      }
    }))
    const runner = new TextGeneration()
    await expect(
      runner.generate({ provider, request: input(parent.signal), maxOutputChars: 100 })
    ).rejects.toBe(reason)
    expect(closed).toBe(true)
  })

  it('user cancels at stream completion when text was valid, then cancellation wins', async () => {
    const parent = new AbortController()
    const reason = new Error('Cancelled at completion')
    const provider = providerFrom(async () => ({
      async *[Symbol.asyncIterator](): AsyncIterator<ProviderStreamPart> {
        yield text('Draft')
        yield stop
        parent.abort(reason)
      }
    }))
    const runner = new TextGeneration()
    await expect(
      runner.generate({ provider, request: input(parent.signal), maxOutputChars: 100 })
    ).rejects.toBe(reason)
  })

  it('user shuts down during provider dispatch when generating, then pending work is aborted', async () => {
    const runner = new TextGeneration()
    let aborted = false
    const provider = providerFrom(async (request) => {
      runner.dispose()
      aborted = request.signal.aborted
      return streamFrom([text('Ignored'), stop])
    })
    await expect(
      runner.generate({ provider, request: input(), maxOutputChars: 100 })
    ).rejects.toThrow(/abort/i)
    expect(aborted).toBe(true)
    await expect(
      runner.generate({ provider, request: input(), maxOutputChars: 100 })
    ).rejects.toThrow('disposed')
    await runner.drain()
  })

  it('user shuts down concurrent requests when providers ignore abort, then drain waits for both', async () => {
    const runner = new TextGeneration()
    const first = deferred<AsyncIterable<ProviderStreamPart>>()
    const second = deferred<AsyncIterable<ProviderStreamPart>>()
    const signals: AbortSignal[] = []
    const provider = providerFrom(async (request) => {
      signals.push(request.signal)
      return signals.length === 1 ? first.promise : second.promise
    })
    const results = [first, second].map(() =>
      runner.generate({ provider, request: input(), maxOutputChars: 100 })
    )
    const rejections = results.map((result) => expect(result).rejects.toThrow(/abort/i))
    runner.dispose()
    expect(signals.map((signal) => signal.aborted)).toEqual([true, true])
    let drained = false
    const draining = runner.drain().then(() => {
      drained = true
    })
    first.resolve(streamFrom([]))
    await rejections[0]
    expect(drained).toBe(false)
    second.resolve(streamFrom([]))
    await rejections[1]
    await draining
    expect(drained).toBe(true)
  })

  it('user encounters a provider failure when generating, then the original error survives', async () => {
    const failure = new Error('Network disconnected')
    const provider = providerFrom(async () => {
      throw failure
    })
    const runner = new TextGeneration()
    await expect(runner.generate({ provider, request: input(), maxOutputChars: 100 })).rejects.toBe(
      failure
    )
    await runner.drain()
  })
})
