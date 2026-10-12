import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChatProvider } from '@mico/ai-providers'
import type { TurnStreamEvent } from '@shared/ipc/schemas/chat'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionDatabase } from '@main/data/session-database'
import { SessionRuntimeService } from './runtime'
import {
  createModels,
  createTemporaryWorkspace,
  isTitleStream,
  removeTemporaryPaths
} from './test-helpers'
import { SessionModelProfile } from './model-profile'
import { TurnExecutor } from './turn'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}
const configuration = {
  provider: 'ollama' as const,
  baseUrl: 'http://localhost:11434',
  modelId: 'original'
}
const message = { role: 'user' as const, parts: [{ type: 'text' as const, text: 'request' }] }

async function setup(provider: ChatProvider) {
  const database = new SessionDatabase({ getUserDataPath: () => ':memory:' })
  await database.initialize()
  const runtime = new SessionRuntimeService({ database })
  const session = runtime.createSession({ title: 'Recovery', defaultProfile: null })
  const models = await createModels(
    () => ({
      ...provider,
      stream: (input) =>
        isTitleStream(input)
          ? Promise.resolve({ async *[Symbol.asyncIterator]() {} })
          : provider.stream(input)
    }),
    configuration,
    'original-entry'
  )
  const profiles = new SessionModelProfile({ models, runtime })
  return { database, runtime, session, profiles, models }
}

describe('TurnExecutor recovery', () => {
  afterEach(removeTemporaryPaths)
  it('user stops a live tool batch when one sibling settled, then its known result remains durable and displayed', async () => {
    const cwd = await createTemporaryWorkspace('mico-live-sibling-')
    await writeFile(join(cwd, 'known.txt'), 'known result')
    const waiting = deferred<void>()
    const known = deferred<void>()
    const provider: ChatProvider = {
      getModelCapabilities: async () => null,
      stream: async () => ({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'tool-input-available' as const,
            toolCallId: 'known',
            toolName: 'Read',
            input: { file_path: 'known.txt' },
            dynamic: true
          }
          yield {
            type: 'tool-input-available' as const,
            toolCallId: 'waiting',
            toolName: 'Read',
            input: { file_path: 'known.txt' },
            dynamic: true
          }
        }
      })
    }
    const { database, runtime, profiles } = await setup(provider)
    const session = runtime.createSession({
      title: 'Project',
      defaultProfile: null,
      projectId: 'project',
      cwd
    })
    const executor = new TurnExecutor({
      profiles,
      runtime,
      toolHooks: {
        preToolUse: [
          async (context) => {
            if (context.toolCallId === 'waiting') {
              waiting.resolve()
              await new Promise<void>((resolve) =>
                context.signal.addEventListener('abort', () => resolve(), { once: true })
              )
            }
          }
        ],
        postToolUse: [
          async (context) => {
            if (context.toolCallId === 'known') known.resolve()
          }
        ]
      }
    })
    executor.startTurn(
      {
        ownerId: 'window',
        request: { sessionId: session.id, requestId: 'tools', userMessage: message }
      },
      () => undefined
    )
    await Promise.all([waiting.promise, known.promise])
    await executor.abortTurn({ ownerId: 'window', requestId: 'tools' })
    expect(runtime.loadSession(session.id).messages.at(-1)).toMatchObject({
      role: 'assistant',
      parts: [{ type: 'tool-trace', toolCallId: 'known', state: 'output-available' }],
      metadata: { completionState: 'stopped' }
    })
    const settlements = database.connection
      .prepare("SELECT COUNT(*) AS count FROM runtime_events WHERE kind = 'tool_execution_settled'")
      .get()
    expect(settlements).toEqual({ count: 1 })
    database.close()
  })
  it('user stops a pending response when sending again, then cancellation acknowledges durable settlement first', async () => {
    const started = deferred<void>()
    const released = deferred<void>()
    const provider: ChatProvider = {
      getModelCapabilities: async () => null,
      stream: async () => ({
        async *[Symbol.asyncIterator]() {
          started.resolve()
          await released.promise
          yield* []
        }
      })
    }
    const { database, runtime, session, profiles } = await setup(provider)
    const executor = new TurnExecutor({ profiles, runtime })
    const events: TurnStreamEvent[] = []
    executor.startTurn(
      {
        ownerId: 'window',
        request: { sessionId: session.id, requestId: 'pending', userMessage: message }
      },
      (event) => events.push(event)
    )
    await started.promise
    let acknowledged = false
    const stopped = Promise.resolve(
      executor.abortTurn({ ownerId: 'window', requestId: 'pending' })
    ).then(() => {
      acknowledged = true
    })
    await Promise.resolve()
    expect(events.at(-1)).toEqual({ type: 'cancelled', requestId: 'pending' })
    expect(acknowledged).toBe(false)
    expect(database.connection.prepare('SELECT status FROM runs').get()).toEqual({
      status: 'running'
    })
    released.resolve()
    await stopped
    expect(database.connection.prepare('SELECT status FROM runs').get()).toEqual({
      status: 'cancelled'
    })
    expect(() =>
      runtime.startTurn({
        sessionId: session.id,
        requestId: 'next',
        userMessage: message,
        profile: profiles.toProfile(configuration, 'original-entry', 'none')
      })
    ).not.toThrow()
    database.close()
  })
  it('user replaces a request with the same identity when shutdown times out, then both old executions remain gated', async () => {
    const streams = [deferred<AsyncIterable<never>>(), deferred<AsyncIterable<never>>()]
    let calls = 0
    const provider: ChatProvider = {
      getModelCapabilities: async () => null,
      stream: () => streams[calls++].promise
    }
    const { database, runtime, session, profiles } = await setup(provider)
    const executor = new TurnExecutor({ profiles, runtime })
    vi.useFakeTimers()
    try {
      const request = {
        ownerId: 'window',
        request: { sessionId: session.id, requestId: 'same', userMessage: message }
      }
      const events: TurnStreamEvent[] = []
      executor.startTurn(request, (event) => events.push(event))
      await vi.advanceTimersByTimeAsync(0)
      const second = runtime.createSession({ title: 'Second', defaultProfile: null })
      executor.startTurn(
        {
          ...request,
          request: { ...request.request, sessionId: second.id }
        },
        (event) => events.push(event)
      )
      await vi.advanceTimersByTimeAsync(0)
      executor.dispose()
      const drained = executor.drain(10)
      await vi.advanceTimersByTimeAsync(10)
      await drained
      for (const stream of streams)
        stream.resolve({
          async *[Symbol.asyncIterator]() {
            yield* []
          }
        })
      await vi.advanceTimersByTimeAsync(0)
      expect(events.filter((event) => event.type !== 'context-measurement')).toEqual([
        { type: 'cancelled', requestId: 'same' },
        { type: 'cancelled', requestId: 'same' }
      ])
      expect(vi.getTimerCount()).toBe(0)
      expect(() => executor.startTurn(request, () => undefined)).toThrow('shutting down')
      database.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('user quits during model capability lookup when setup is pending, then no run is created after storage closes', async () => {
    const capabilities = deferred<null>()
    const stream = vi.fn<ChatProvider['stream']>(async () => ({
      async *[Symbol.asyncIterator]() {}
    }))
    const { database, runtime, session, profiles } = await setup({
      stream,
      getModelCapabilities: () => capabilities.promise
    })
    const executor = new TurnExecutor({ profiles, runtime })
    vi.useFakeTimers()
    try {
      const events: TurnStreamEvent[] = []
      executor.startTurn(
        {
          ownerId: 'window',
          request: { sessionId: session.id, requestId: 'pending', userMessage: message }
        },
        (event) => events.push(event)
      )
      executor.dispose()
      const drained = executor.drain(10)
      await vi.advanceTimersByTimeAsync(10)
      await drained
      expect(database.connection.prepare('SELECT COUNT(*) AS count FROM runs').get()).toEqual({
        count: 0
      })
      database.close()
      capabilities.resolve(null)
      await vi.advanceTimersByTimeAsync(0)
      expect(stream).not.toHaveBeenCalled()
      expect(events).toEqual([{ type: 'cancelled', requestId: 'pending' }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('user retries after selecting a different session model when the old run failed, then its original provider runs', async () => {
    const called: string[] = []
    const provider: ChatProvider = {
      getModelCapabilities: async () => null,
      stream: async () => ({
        async *[Symbol.asyncIterator]() {
          yield { type: 'text-delta' as const, id: 'a', delta: 'recovered' }
        }
      })
    }
    const { database, runtime, session } = await setup(provider)
    const models = await createModels(
      (selected) => {
        called.push(selected.modelId)
        return provider
      },
      configuration,
      'original-entry'
    )
    await models.saveLibrary({
      ...models.getLibrary(),
      models: [
        ...models.getLibrary().models,
        {
          id: 'different-entry',
          provider: 'ollama',
          modelId: 'different',
          displayName: 'Different',
          enabled: true
        }
      ]
    })
    const profiles = new SessionModelProfile({ runtime, models })
    const profile = profiles.toProfile(configuration, 'original-entry', 'none')
    const failed = runtime.startTurn({
      sessionId: session.id,
      requestId: 'failed',
      userMessage: message,
      profile
    })
    runtime.finishRun(failed.runId, {
      status: 'failed',
      failure: { code: 'provider_error', message: 'Failed' }
    })
    runtime.updateDefaultProfile(
      session.id,
      profiles.toProfile({ ...configuration, modelId: 'different' }, 'different-entry', 'none')
    )
    const executor = new TurnExecutor({ profiles, runtime })
    const terminal = deferred<void>()
    executor.startTurn(
      {
        ownerId: 'window',
        request: {
          sessionId: session.id,
          requestId: 'retry',
          userMessage: message,
          retryRunId: failed.runId
        }
      },
      (event) => {
        if (event.type === 'finish' || event.type === 'error') terminal.resolve()
      }
    )
    await terminal.promise
    expect(called).toEqual(['original'])
    expect(runtime.loadSession(session.id).messages.at(-1)).toMatchObject({
      role: 'assistant',
      parts: [{ type: 'text', text: 'recovered' }]
    })
    database.close()
  })
})
