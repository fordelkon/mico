import { describe, expect, it, vi } from 'vitest'

import type { TurnStartRequest, TurnStreamEvent } from '@shared/ipc/schemas/chat'
import type { ChatProvider } from '@mico/ai-providers'
import type { UIMessageChunk } from 'ai'
import {
  SessionRuntimeService,
  type ExecutionProfileSnapshot
} from '../sessions/session-runtime-service'
import { SessionDatabase } from '../../data/session-database'
import { createChatProviderResolver } from './chat-provider-resolver'
import { SESSION_TITLE_INSTRUCTIONS, TurnExecutor } from './turn-executor'

// Title generation and agent turns share one provider.stream() interface; the
// title prompt is the only observable signal distinguishing the two calls.
function isTitleStream(input: Parameters<ChatProvider['stream']>[0]): boolean {
  const firstPart = input.messages[0]?.parts[0]
  return (
    input.messages[0]?.role === 'system' &&
    firstPart?.type === 'text' &&
    firstPart.text === SESSION_TITLE_INSTRUCTIONS
  )
}

const request: TurnStartRequest = {
  sessionId: 'session-1',
  requestId: 'request-1',
  userMessage: { role: 'user', parts: [{ type: 'text', text: 'Hello' }] }
}

const textChunk: UIMessageChunk = {
  type: 'text-delta',
  id: 'part-1',
  delta: 'Hi'
}

const configuration = {
  provider: 'ollama' as const,
  baseUrl: 'http://localhost:11434',
  modelId: 'qwen3:8b'
}

const savedProfile: ExecutionProfileSnapshot = {
  modelEntryId: 'ollama:qwen3',
  providerId: 'ollama',
  modelId: 'qwen3:8b',
  thinkingEffort: 'default',
  configurationDigest: 'saved-configuration'
}

async function createRuntime(): Promise<{
  database: SessionDatabase
  runtime: SessionRuntimeService
}> {
  const database = new SessionDatabase({ getUserDataPath: () => ':memory:' })
  await database.initialize()
  return { database, runtime: new SessionRuntimeService({ database }) }
}

async function createSession(
  title: string,
  options: Partial<Parameters<SessionRuntimeService['createSession']>[0]> = {}
): Promise<{
  database: SessionDatabase
  runtime: SessionRuntimeService
  session: ReturnType<SessionRuntimeService['createSession']>
}> {
  const { database, runtime } = await createRuntime()
  return {
    database,
    runtime,
    session: runtime.createSession({ title, defaultProfile: null, ...options })
  }
}

function createConfiguredExecutor(
  stream: ChatProvider['stream'],
  runtime: SessionRuntimeService,
  options: Omit<
    NonNullable<ConstructorParameters<typeof TurnExecutor>[1]>,
    'getSelectedChatConfiguration' | 'runtime'
  > = {}
): TurnExecutor {
  return new TurnExecutor(() => createProvider(stream), {
    getSelectedChatConfiguration: () => configuration,
    runtime,
    ...options
  })
}

function createDeferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function collectEvents() {
  const events: TurnStreamEvent[] = []
  const firstChunk = createDeferred()
  const terminal = createDeferred()

  return {
    emit: (event) => {
      events.push(event)
      if (event.type === 'chunk') firstChunk.resolve()
      if (event.type === 'cancelled' || event.type === 'error' || event.type === 'finish') {
        terminal.resolve()
      }
    },
    events,
    firstChunk: firstChunk.promise,
    terminal: terminal.promise
  }
}

function streamFrom(chunks: UIMessageChunk[]): AsyncIterable<UIMessageChunk> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<UIMessageChunk> {
      yield* chunks
    }
  }
}

function pendingStream(signal: AbortSignal, onStopped?: () => void): AsyncIterable<UIMessageChunk> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<UIMessageChunk> {
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true })
      )
      onStopped?.()
      yield* []
    }
  }
}

function partialPendingStream(signal: AbortSignal): AsyncIterable<UIMessageChunk> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<UIMessageChunk> {
      yield { type: 'text-delta', id: 'part-1', delta: 'Partial' }
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true })
      )
    }
  }
}

describe('TurnExecutor', () => {
  it('user sends a document-only message when starting a turn, then it is sent as named text', async () => {
    const { runtime, session } = await createSession('New chat')
    const calls: Parameters<ChatProvider['stream']>[0][] = []
    const titleGenerated = createDeferred()
    const recorded = collectEvents()
    const service = createConfiguredExecutor(async (input) => {
      calls.push(input)
      return streamFrom([{ type: 'text-delta', id: 'part-1', delta: 'Review code' }])
    }, runtime)
    service.startTurn(
      {
        ownerId: 'window-1',
        request: {
          ...request,
          sessionId: session.id,
          userMessage: {
            role: 'user',
            parts: [{ type: 'document', name: 'index.ts', text: '  export {}\n' }]
          }
        }
      },
      recorded.emit,
      titleGenerated.resolve
    )
    await recorded.terminal

    const expected = {
      role: 'user',
      parts: [{ type: 'text', text: '<document name="index.ts">\n  export {}\n\n</document>' }]
    }
    expect(calls.find((input) => !isTitleStream(input))?.messages).toEqual([expected])
    expect(calls.find((input) => isTitleStream(input))?.messages[1]).toEqual(expected)
    await titleGenerated.promise
  })

  it('user sends attached documents when the turn starts, then they are sent as named text', async () => {
    const calls: Parameters<ChatProvider['stream']>[0][] = []
    const recorded = collectEvents()
    const service = new TurnExecutor(() =>
      createProvider(async (input) => {
        calls.push(input)
        return streamFrom([])
      })
    )
    service.startTurn(
      {
        ownerId: 'window-1',
        request: {
          ...request,
          userMessage: {
            role: 'user',
            parts: [
              { type: 'text', text: 'Review this file.' },
              { type: 'document', name: 'a&"b.ts', text: 'export {}' },
              {
                type: 'reasoning',
                text: 'Reasoning',
                providerMetadata: { test: { signature: 'value' } }
              }
            ]
          }
        }
      },
      recorded.emit
    )
    await recorded.terminal
    expect(calls[0]?.messages).toEqual([
      {
        role: 'user',
        parts: [
          { type: 'text', text: 'Review this file.' },
          { type: 'text', text: '<document name="a&amp;&quot;b.ts">\nexport {}\n</document>' },
          {
            type: 'reasoning',
            text: 'Reasoning',
            providerMetadata: { test: { signature: 'value' } }
          }
        ]
      }
    ])
  })

  it('user gets the session model used when a session has a profile, then the global model is ignored', async () => {
    const { runtime, session } = await createSession('Session', {
      defaultProfile: {
        modelEntryId: 'session-model',
        providerId: 'ollama',
        modelId: 'session-model-id',
        thinkingEffort: 'default',
        configurationDigest: 'saved-configuration'
      }
    })
    const resolvedEntryIds: Array<string | undefined> = []
    const recorded = collectEvents()
    const service = new TurnExecutor(
      (modelEntryId) => {
        resolvedEntryIds.push(modelEntryId)
        return modelEntryId === 'session-model' ? createProvider(async () => streamFrom([])) : null
      },
      {
        getChatConfigurationForModelEntry: (modelEntryId) =>
          modelEntryId === 'session-model' ? configuration : null,
        getSelectedModelEntryId: () => 'global-model',
        runtime
      }
    )

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      recorded.emit
    )

    await recorded.terminal
    expect(resolvedEntryIds).toEqual(['session-model'])
  })

  it('user sees an error when no enabled model is selected, then the run finishes with it', async () => {
    const recorded = collectEvents()
    const service = new TurnExecutor(
      createChatProviderResolver({
        createChatProvider: () => createProvider(async () => streamFrom([])),
        getChatConfigurationForModelEntry: () => null
      })
    )

    await expect(service.getModelCapabilities()).resolves.toBeNull()
    service.startTurn({ ownerId: 'window-1', request }, recorded.emit)

    await recorded.terminal
    expect(recorded.events).toEqual([
      {
        type: 'error',
        requestId: 'request-1',
        message: 'Select an enabled model in Settings before chatting.'
      }
    ])
  })

  it('user sees every chunk when the provider streams normally, then one finish event follows', async () => {
    const recorded = collectEvents()
    const provider = createProvider(async () => streamFrom([textChunk]))
    const service = new TurnExecutor(() => provider)

    service.startTurn({ ownerId: 'window-1', request }, recorded.emit)

    await recorded.terminal
    expect(recorded.events).toEqual([
      { type: 'chunk', requestId: 'request-1', chunk: textChunk },
      {
        type: 'chunk',
        requestId: 'request-1',
        chunk: { type: 'message-metadata', messageMetadata: { completionState: 'complete' } }
      },
      { type: 'finish', requestId: 'request-1' }
    ])
  })

  it('user sees the transcript persisted when the run finishes, then both messages are stored', async () => {
    const { runtime, session } = await createSession('Session')
    const recorded = collectEvents()
    const service = createConfiguredExecutor(async () => streamFrom([textChunk]), runtime)

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      recorded.emit
    )

    await recorded.terminal
    expect(runtime.loadSession(session.id).messages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
      {
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hi' }],
        metadata: { completionState: 'complete' }
      }
    ])
  })

  it('user sees a generated title when the first message completes, then it is persisted', async () => {
    const { runtime, session } = await createSession('New chat')
    let titleInstructions = ''
    const recorded = collectEvents()
    const service = createConfiguredExecutor(async ({ messages }) => {
      if (messages[0]?.role === 'system') {
        titleInstructions = messages[0].parts[0]?.type === 'text' ? messages[0].parts[0].text : ''
        return streamFrom([{ type: 'text-delta', id: 'title-part', delta: 'Greet the user' }])
      }
      return streamFrom([textChunk])
    }, runtime)
    const titleGenerated = createDeferred()

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      recorded.emit,
      () => titleGenerated.resolve()
    )

    await titleGenerated.promise
    expect(runtime.loadSession(session.id).title).toBe('Greet the user')
    expect(titleInstructions).toContain("Capture the user's actual goal")
    expect(titleInstructions).toContain('Preserve technical terms')
    expect(titleInstructions).toContain('Output exactly one title')
  })

  it('user sees a title capped at 50 characters when generation returns more, then the rest is trimmed', async () => {
    const { runtime, session } = await createSession('New chat')
    const recorded = collectEvents()
    const service = createConfiguredExecutor(
      async ({ messages }) =>
        streamFrom(
          messages[0]?.role === 'system'
            ? [
                {
                  type: 'text-delta',
                  id: 'title-part',
                  delta: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab'
                }
              ]
            : [textChunk]
        ),
      runtime
    )
    const titleGenerated = createDeferred()

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      recorded.emit,
      () => titleGenerated.resolve()
    )

    await titleGenerated.promise
    expect(runtime.loadSession(session.id).title).toBe(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )
  })

  it('user sees assistant text capped when it exceeds the maximum, then the persisted reply is truncated', async () => {
    const { runtime, session } = await createSession('Session')
    const recorded = collectEvents()
    const service = createConfiguredExecutor(
      async () =>
        streamFrom([
          { type: 'text-delta', id: 'part-1', delta: 'abcd' },
          { type: 'text-delta', id: 'part-1', delta: 'efgh' },
          { type: 'text-delta', id: 'part-1', delta: 'ignored' }
        ]),
      runtime,
      { maxAssistantTextChars: 6 }
    )

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      recorded.emit
    )

    await recorded.terminal
    expect(runtime.loadSession(session.id).messages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
      {
        role: 'assistant',
        parts: [{ type: 'text', text: 'abcde\u2026' }],
        metadata: { completionState: 'complete' }
      }
    ])
    expect(recorded.events).toEqual([
      {
        type: 'chunk',
        requestId: 'request-1',
        chunk: { type: 'text-delta', id: 'part-1', delta: 'abcd' }
      },
      {
        type: 'chunk',
        requestId: 'request-1',
        chunk: { type: 'text-delta', id: 'part-1', delta: 'e\u2026' }
      },
      {
        type: 'chunk',
        requestId: 'request-1',
        chunk: { type: 'message-metadata', messageMetadata: { completionState: 'complete' } }
      },
      { type: 'finish', requestId: 'request-1' }
    ])
  })

  it('user sees truncation applied when a chunk exactly fills the cap, then following content is dropped', async () => {
    const { runtime, session } = await createSession('Session')
    const recorded = collectEvents()
    const service = createConfiguredExecutor(
      async () =>
        streamFrom([
          { type: 'text-delta', id: 'part-1', delta: 'abcdef' },
          { type: 'text-delta', id: 'part-1', delta: 'g' }
        ]),
      runtime,
      { maxAssistantTextChars: 6 }
    )

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      recorded.emit
    )

    await recorded.terminal
    // The persisted reply matches what streamed: the overflow delta was dropped
    // silently, so the transcript must not retroactively append a truncation marker.
    expect(runtime.loadSession(session.id).messages.at(-1)).toEqual({
      role: 'assistant',
      parts: [{ type: 'text', text: 'abcdef' }],
      metadata: { completionState: 'complete' }
    })
    expect(recorded.events).toEqual([
      {
        type: 'chunk',
        requestId: 'request-1',
        chunk: { type: 'text-delta', id: 'part-1', delta: 'abcdef' }
      },
      {
        type: 'chunk',
        requestId: 'request-1',
        chunk: { type: 'message-metadata', messageMetadata: { completionState: 'complete' } }
      },
      { type: 'finish', requestId: 'request-1' }
    ])
  })

  it('user sees the run completed when the provider returns no text, then an empty reply is persisted', async () => {
    const { database, runtime, session } = await createSession('Session')
    const recorded = collectEvents()
    const service = createConfiguredExecutor(async () => streamFrom([]), runtime)

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      recorded.emit
    )

    await recorded.terminal
    expect(database.connection.prepare('SELECT status FROM runs').all()).toEqual([
      { status: 'completed' }
    ])
    expect(runtime.loadSession(session.id).messages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
      {
        role: 'assistant',
        parts: [{ type: 'text', text: '' }],
        metadata: { completionState: 'complete' }
      }
    ])
  })

  it('user sees the run failed when the provider throws, then no assistant output is persisted', async () => {
    const { database, runtime, session } = await createSession('Session')
    const recorded = collectEvents()
    const service = createConfiguredExecutor(
      async () => {
        throw new Error('upstream failure')
      },
      runtime,
      { maxAttempts: 1 }
    )

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      recorded.emit
    )

    await recorded.terminal
    expect(runtime.loadSession(session.id).messages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'Hello' }] }
    ])
    expect(database.connection.prepare('SELECT status FROM runs').all()).toEqual([
      { status: 'failed' }
    ])
  })

  it('user retries a failed turn when starting with retry, then the message is not persisted twice', async () => {
    const { runtime, session } = await createSession('Session')
    const failed = runtime.startTurn({
      sessionId: session.id,
      requestId: 'request-0',
      userMessage: request.userMessage,
      profile: savedProfile
    })
    runtime.finishRun(failed.runId, {
      status: 'failed',
      failure: { code: 'provider_error', message: 'Failed' }
    })
    const recorded = collectEvents()
    const service = createConfiguredExecutor(async () => streamFrom([textChunk]), runtime)

    service.startTurn(
      {
        ownerId: 'window-1',
        request: { ...request, sessionId: session.id, retry: true }
      },
      recorded.emit
    )

    await recorded.terminal
    expect(runtime.loadSession(session.id).messages).toEqual([
      request.userMessage,
      {
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hi' }],
        metadata: { completionState: 'complete' }
      }
    ])
  })

  it('user cancels the run when aborting, then the persisted run is marked cancelled', async () => {
    const { database, runtime, session } = await createSession('Session')
    const providerStarted = createDeferred()
    const service = createConfiguredExecutor(async ({ signal }) => {
      providerStarted.resolve()
      return pendingStream(signal)
    }, runtime)

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      () => undefined
    )
    await providerStarted.promise
    service.abortTurn({ ownerId: 'window-1', requestId: request.requestId })

    expect(runtime.loadSession(session.id).messages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'Hello' }] }
    ])
    expect(database.connection.prepare('SELECT status FROM runs').all()).toEqual([
      { status: 'cancelled' }
    ])
  })

  it('user keeps the partial response when aborting mid-stream, then it is included in the next turn', async () => {
    const { runtime, session } = await createSession('Session')
    const recorded = collectEvents()
    const service = createConfiguredExecutor(
      async ({ signal }) => partialPendingStream(signal),
      runtime
    )

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      recorded.emit
    )
    await recorded.firstChunk
    service.abortTurn({ ownerId: 'window-1', requestId: request.requestId })

    expect(runtime.loadSession(session.id).messages).toEqual([
      request.userMessage,
      {
        role: 'assistant',
        parts: [{ type: 'text', text: 'Partial' }],
        metadata: { completionState: 'stopped' }
      }
    ])

    const next = runtime.startTurn({
      sessionId: session.id,
      requestId: 'request-2',
      userMessage: { role: 'user', parts: [{ type: 'text', text: 'Continue' }] },
      profile: savedProfile
    })
    expect(runtime.getReplayMessages(next.runId)).toEqual([
      request.userMessage,
      {
        role: 'assistant',
        parts: [{ type: 'text', text: 'Partial' }]
      },
      { role: 'user', parts: [{ type: 'text', text: 'Continue' }] }
    ])
  })

  it('user gets the request built when prior turns exist, then history and the prompt form the messages', async () => {
    const { runtime, session } = await createSession('Session')
    const firstRun = runtime.startTurn({
      sessionId: session.id,
      requestId: 'request-0',
      userMessage: { role: 'user', parts: [{ type: 'text', text: 'Saved prompt' }] },
      profile: savedProfile
    })
    runtime.finishRun(firstRun.runId, {
      status: 'completed',
      assistant: {
        role: 'assistant',
        parts: [{ type: 'text', text: 'Saved answer' }]
      }
    })
    const streamCalled = createDeferred()
    const stream = vi.fn<ChatProvider['stream']>(async () => {
      streamCalled.resolve()
      return streamFrom([])
    })
    const service = createConfiguredExecutor(stream, runtime)

    service.startTurn(
      {
        ownerId: 'window-1',
        request: {
          ...request,
          sessionId: session.id,
          userMessage: { role: 'user', parts: [{ type: 'text', text: 'Current prompt' }] }
        }
      },
      () => undefined
    )

    await streamCalled.promise
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: 'user', parts: [{ type: 'text', text: 'Saved prompt' }] },
          { role: 'assistant', parts: [{ type: 'text', text: 'Saved answer' }] },
          { role: 'user', parts: [{ type: 'text', text: 'Current prompt' }] }
        ]
      })
    )
  })

  it('user sees a setup error when the run cannot start, then the provider is never called', async () => {
    const { runtime } = await createRuntime()
    const stream = vi.fn<ChatProvider['stream']>(async () => streamFrom([]))
    const service = createConfiguredExecutor(stream, runtime)
    const recorded = collectEvents()

    service.startTurn({ ownerId: 'window-1', request }, recorded.emit)

    await recorded.terminal
    expect(recorded.events[0]).toMatchObject({ type: 'error', requestId: request.requestId })
    expect(stream).not.toHaveBeenCalled()
  })

  it('user aborts only the matching run when targeting it, then one terminal event is emitted', async () => {
    const events: TurnStreamEvent[] = []
    const signals = new Map<string, AbortSignal>()
    const streamsStarted = createDeferred()
    const firstStreamStopped = createDeferred()
    const provider = createProvider(async ({ signal }) => {
      signals.set(String(signals.size + 1), signal)
      if (signals.size === 2) streamsStarted.resolve()
      return pendingStream(signal, signals.size === 1 ? firstStreamStopped.resolve : undefined)
    })
    const service = new TurnExecutor(() => provider)

    service.startTurn({ ownerId: 'window-1', request }, (event) => events.push(event))
    service.startTurn(
      { ownerId: 'window-2', request: { ...request, requestId: 'request-2' } },
      (event) => events.push(event)
    )
    await streamsStarted.promise

    service.abortTurn({ ownerId: 'window-1', requestId: 'request-1' })
    service.abortTurn({ ownerId: 'window-1', requestId: 'request-1' })

    expect(signals.get('1')?.aborted).toBe(true)
    expect(signals.get('2')?.aborted).toBe(false)
    await firstStreamStopped.promise
    expect(events).toEqual([{ type: 'cancelled', requestId: 'request-1' }])
  })

  it('user keeps same-ID requests isolated when aborting one owner, then only that owner is aborted', async () => {
    const signals: AbortSignal[] = []
    const streamsStarted = createDeferred()
    const provider = createProvider(async ({ signal }) => {
      signals.push(signal)
      if (signals.length === 2) streamsStarted.resolve()
      return pendingStream(signal)
    })
    const service = new TurnExecutor(() => provider)

    service.startTurn({ ownerId: 'window-1', request }, () => undefined)
    service.startTurn({ ownerId: 'window-2', request }, () => undefined)
    await streamsStarted.promise

    service.abortAllTurns('window-1')

    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)
  })

  it('user sees every active run aborted when the executor is disposed, then all signals abort', async () => {
    const signals: AbortSignal[] = []
    const streamsStarted = createDeferred()
    const provider = createProvider(async ({ signal }) => {
      signals.push(signal)
      if (signals.length === 2) streamsStarted.resolve()
      return pendingStream(signal)
    })
    const service = new TurnExecutor(() => provider)

    service.startTurn({ ownerId: 'window-1', request }, () => undefined)
    service.startTurn(
      { ownerId: 'window-2', request: { ...request, requestId: 'request-2' } },
      () => undefined
    )
    await streamsStarted.promise

    service.dispose()

    expect(signals.map((signal) => signal.aborted)).toEqual([true, true])
  })

  it('user sees a safe generic error when the stream fails, then upstream details are hidden', async () => {
    const recorded = collectEvents()
    const stream = vi.fn<ChatProvider['stream']>(async () => {
      throw new Error('upstream credential details')
    })
    const service = new TurnExecutor(() => createProvider(stream))

    service.startTurn({ ownerId: 'window-1', request }, recorded.emit)

    await recorded.terminal
    expect(recorded.events).toEqual([
      {
        type: 'error',
        requestId: 'request-1',
        message: "Couldn't generate a response. Please try again."
      }
    ])
  })

  it('user sees a retry when the connection fails before any content, then the run finishes normally', async () => {
    const recorded = collectEvents()
    let calls = 0
    const stream = async () => {
      calls += 1
      if (calls === 1) throw new TypeError('fetch failed')
      return streamFrom([textChunk])
    }
    const service = new TurnExecutor(() => createProvider(stream), {
      maxAttempts: 2,
      retryDelayMs: 0
    })

    service.startTurn({ ownerId: 'window-1', request }, recorded.emit)

    await recorded.terminal
    expect(recorded.events).toEqual([
      {
        type: 'retry',
        requestId: 'request-1',
        attempt: 2,
        maxAttempts: 2,
        retryDelayMs: 0
      },
      { type: 'chunk', requestId: 'request-1', chunk: textChunk },
      {
        type: 'chunk',
        requestId: 'request-1',
        chunk: { type: 'message-metadata', messageMetadata: { completionState: 'complete' } }
      },
      { type: 'finish', requestId: 'request-1' }
    ])
  })

  it('user keeps the partial content when the connection fails mid-stream, then the run errors without retry', async () => {
    const recorded = collectEvents()
    const provider = createProvider(async () => ({
      async *[Symbol.asyncIterator](): AsyncIterator<UIMessageChunk> {
        yield textChunk
        throw new TypeError('fetch failed')
      }
    }))
    const service = new TurnExecutor(() => provider, { maxAttempts: 2, retryDelayMs: 0 })

    service.startTurn({ ownerId: 'window-1', request }, recorded.emit)

    await recorded.terminal
    expect(recorded.events).toEqual([
      { type: 'chunk', requestId: 'request-1', chunk: textChunk },
      {
        type: 'error',
        requestId: 'request-1',
        message: "Couldn't connect to the API endpoint. Check the API URL, network, VPN, or proxy."
      }
    ])
  })

  it('user gets the requested thinking effort when starting a turn, then it reaches the provider', async () => {
    const streamCalled = createDeferred()
    const stream = vi.fn<ChatProvider['stream']>(async () => {
      streamCalled.resolve()
      return streamFrom([])
    })
    const service = new TurnExecutor(() => createProvider(stream))

    service.startTurn(
      {
        ownerId: '42',
        request: { ...request, sessionId: 'session-1', thinkingEffort: 'high' }
      },
      () => undefined
    )

    await streamCalled.promise
    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ thinkingEffort: 'high' }))
  })

  it('user sees a tool trace persisted when a tool call completes, then it is stored with the reply', async () => {
    const { runtime, session } = await createSession('Project chat', {
      projectId: 'project-1',
      cwd: process.cwd()
    })
    let agentRequests = 0
    const recorded = collectEvents()
    const service = createConfiguredExecutor(async (input) => {
      if (isTitleStream(input)) return streamFrom([])
      agentRequests += 1
      return agentRequests === 1
        ? streamFrom([
            // SAFETY: this fixture matches the provider's documented completed tool-call chunk.
            {
              type: 'tool-input-available',
              toolCallId: 'call-1',
              toolName: 'read',
              input: { path: 'package.json', limit: 1 }
            } as UIMessageChunk
          ])
        : streamFrom([{ type: 'text-delta', id: 'answer', delta: 'Done' }])
    }, runtime)

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      recorded.emit
    )
    await recorded.terminal

    expect(runtime.loadSession(session.id).messages.at(-1)).toMatchObject({
      role: 'assistant',
      parts: [
        {
          type: 'tool-trace',
          toolCallId: 'call-1',
          toolName: 'read',
          input: { path: 'package.json' },
          state: 'output-available',
          output: 'Read 1 line.'
        },
        { type: 'text', text: 'Done' }
      ]
    })
  })

  it('user sees the step limit recorded when the model never finishes, then the failure names the budget', async () => {
    const { database, runtime, session } = await createSession('Project chat', {
      projectId: 'project-1',
      cwd: process.cwd()
    })
    let agentRequests = 0
    const recorded = collectEvents()
    const service = createConfiguredExecutor(async (input) => {
      if (isTitleStream(input)) return streamFrom([])
      agentRequests += 1
      return streamFrom([
        // SAFETY: this fixture matches the provider's documented completed tool-call chunk.
        {
          type: 'tool-input-available',
          toolCallId: `call-${agentRequests}`,
          toolName: 'read',
          input: { path: 'package.json', limit: 1 }
        } as UIMessageChunk
      ])
    }, runtime)

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      recorded.emit
    )
    await recorded.terminal

    // SAFETY: runs stores exactly the failure_json column written by finishRun.
    const run = database.connection
      .prepare('SELECT failure_json FROM runs WHERE session_id = ?')
      .get(session.id) as { failure_json: string } | undefined
    expect(JSON.parse(run?.failure_json ?? '{}')).toEqual({
      code: 'step_limit',
      message: 'The agent reached its model step limit before producing a final answer.'
    })
  })

  it('user sees interim text between tool rounds when the turn is replayed, then the transcript keeps the stream order', async () => {
    const { runtime, session } = await createSession('Project chat', {
      projectId: 'project-1',
      cwd: process.cwd()
    })
    let agentRequests = 0
    const recorded = collectEvents()
    const service = createConfiguredExecutor(async (input) => {
      if (isTitleStream(input)) return streamFrom([])
      agentRequests += 1
      if (agentRequests === 1)
        return streamFrom([
          // SAFETY: this fixture conforms to the documented reasoning-start UI chunk.
          { type: 'reasoning-start', id: 'reasoning-1' } as UIMessageChunk,
          // SAFETY: this fixture conforms to the documented reasoning-delta UI chunk.
          { type: 'reasoning-delta', id: 'reasoning-1', delta: 'First thought.' } as UIMessageChunk,
          // SAFETY: this fixture conforms to the documented reasoning-end UI chunk.
          { type: 'reasoning-end', id: 'reasoning-1' } as UIMessageChunk,
          // SAFETY: this fixture matches the provider's documented completed tool-call chunk.
          {
            type: 'tool-input-available',
            toolCallId: 'call-1',
            toolName: 'read',
            input: { path: 'package.json', limit: 1 }
          } as UIMessageChunk
        ])
      if (agentRequests === 2)
        return streamFrom([
          { type: 'text-delta', id: 'interim', delta: 'Found the entry point.' },
          // SAFETY: this fixture matches the provider's documented completed tool-call chunk.
          {
            type: 'tool-input-available',
            toolCallId: 'call-2',
            toolName: 'read',
            input: { path: 'package.json', limit: 1 }
          } as UIMessageChunk
        ])
      return streamFrom([{ type: 'text-delta', id: 'final', delta: 'Done.' }])
    }, runtime)

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      recorded.emit
    )
    await recorded.terminal

    expect(runtime.loadSession(session.id).messages.at(-1)).toMatchObject({
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'First thought.' },
        { type: 'tool-trace', toolCallId: 'call-1', state: 'output-available' },
        { type: 'text', text: 'Found the entry point.' },
        { type: 'tool-trace', toolCallId: 'call-2', state: 'output-available' },
        { type: 'text', text: 'Done.' }
      ],
      metadata: { completionState: 'complete' }
    })
  })

  it('user gets workspace instructions prepended when in a project session, then they lead the request', async () => {
    const cwd = process.cwd()
    const { runtime, session } = await createSession('Project chat', {
      projectId: 'project-1',
      cwd
    })
    const calls: Parameters<ChatProvider['stream']>[0][] = []
    const recorded = collectEvents()
    const service = createConfiguredExecutor(async (input) => {
      calls.push(input)
      return streamFrom([])
    }, runtime)

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      recorded.emit
    )
    await recorded.terminal

    expect(calls.find((input) => !isTitleStream(input))?.messages[0]).toEqual({
      role: 'system',
      parts: [
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining(cwd)
        })
      ]
    })
  })

  it('user sees streamed reasoning persisted when reasoning streams, then it joins the reply', async () => {
    const { runtime, session } = await createSession('New chat')
    // SAFETY: this fixture conforms to the documented reasoning-delta UI chunk.
    const reasoningDelta = {
      type: 'reasoning-delta',
      id: 'reasoning-1',
      delta: 'Visible thought.'
    } as UIMessageChunk
    const recorded = collectEvents()
    const service = createConfiguredExecutor(
      async () =>
        streamFrom([
          // SAFETY: this fixture conforms to the documented reasoning-start UI chunk.
          { type: 'reasoning-start', id: 'reasoning-1' } as UIMessageChunk,
          reasoningDelta,
          // SAFETY: this fixture conforms to the documented reasoning-end UI chunk.
          { type: 'reasoning-end', id: 'reasoning-1' } as UIMessageChunk,
          { type: 'text-delta', id: 'answer', delta: 'Done.' }
        ]),
      runtime
    )

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      recorded.emit
    )
    await recorded.terminal

    expect(runtime.loadSession(session.id).messages.at(-1)).toEqual({
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'Visible thought.' },
        { type: 'text', text: 'Done.' }
      ],
      metadata: { completionState: 'complete' }
    })
  })
})

function createProvider(
  stream: ChatProvider['stream']
): Pick<ChatProvider, 'getModelCapabilities' | 'stream'> {
  return {
    getModelCapabilities: vi.fn<ChatProvider['getModelCapabilities']>(async () => null),
    stream
  }
}
