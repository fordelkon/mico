import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createModels,
  createRuntime,
  createTemporaryWorkspace,
  isTitleStream,
  removeTemporaryPaths
} from './test-helpers'

afterEach(removeTemporaryPaths)

import type { ChatProvider } from '@mico/ai-providers'
import type { TurnStartRequest, TurnStreamEvent } from '@shared/ipc/schemas/chat'
import type { UIMessageChunk } from 'ai'
import { SessionDatabase } from '@main/data/session-database'
import { type ExecutionProfileSnapshot, SessionRuntimeService } from './runtime'
import { Models } from '../models'
import { SessionModelProfile } from './model-profile'
import { TurnExecutor } from './turn'

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

async function createExecutor(
  resolveProvider: () => ChatProvider,
  options: { maxAttempts?: number; retryDelayMs?: number } = {}
): Promise<TurnExecutor> {
  const { runtime } = await createRuntime([request.sessionId, 'session-2'])
  runtime.createSession({ title: 'Session', defaultProfile: null })
  runtime.createSession({ title: 'Second', defaultProfile: null })
  const models = await createModels(() => {
    const provider = resolveProvider()
    return {
      ...provider,
      stream: async (input) => {
        if (isTitleStream(input)) return streamFrom([])
        return provider.stream(input)
      }
    }
  })
  return new TurnExecutor({
    profiles: new SessionModelProfile({ models, runtime }),
    runtime,
    ...options
  })
}

async function createConfiguredExecutor(
  stream: ChatProvider['stream'],
  runtime: SessionRuntimeService,
  options: {
    maxAssistantTextChars?: number
    maxAttempts?: number
    retryDelayMs?: number
  } = {}
): Promise<TurnExecutor> {
  const models = await createModels(() => createProvider(stream))
  return new TurnExecutor({
    profiles: new SessionModelProfile({ models, runtime }),
    runtime,
    maxAssistantTextChars: options.maxAssistantTextChars,
    maxAttempts: options.maxAttempts,
    retryDelayMs: options.retryDelayMs
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

function pendingStream(signal: AbortSignal): AsyncIterable<UIMessageChunk> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<UIMessageChunk> {
      if (!signal.aborted)
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true })
        )
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
  it('user invokes a manual skill when retrying after reload, then accepted instructions stay durable', async () => {
    const cwd = await createTemporaryWorkspace('mico-explicit-skill-')
    const base = join(cwd, '.agents/skills/manual')
    await mkdir(base, { recursive: true })
    const skillPath = join(base, 'SKILL.md')
    await writeFile(
      skillPath,
      '---\nname: manual\ndescription: Manual\ndisable-model-invocation: true\n---\nOriginal manual instructions'
    )
    await writeFile(join(base, 'reference.md'), 'Current manual reference')
    const { runtime, database, session } = await createSession('Manual chat', {
      projectId: 'p',
      cwd
    })
    const calls: Parameters<ChatProvider['stream']>[0][] = []
    const userMessage: TurnStartRequest['userMessage'] = {
      role: 'user',
      parts: [
        { type: 'text', text: '/skill:manual Unicode 文件 😀' },
        {
          type: 'data-skill-invocation',
          data: { skillId: 'project-agents:manual', name: 'manual', arguments: 'Unicode 文件 😀' }
        }
      ]
    }
    const first = collectEvents()
    const executor = await createConfiguredExecutor(
      async (input) => {
        if (isTitleStream(input)) return streamFrom([])
        calls.push(input)
        throw new Error('Stop after accepting context')
      },
      runtime,
      { maxAttempts: 1 }
    )
    executor.startTurn(
      { ownerId: 'w', request: { ...request, sessionId: session.id, userMessage } },
      first.emit
    )
    await first.terminal
    expect(first.events.at(-1)?.type).toBe('error')
    expect(JSON.stringify(calls[0]?.messages)).toContain('Original manual instructions')
    expect(calls[0]?.messages.at(-1)).toMatchObject({ role: 'user' })
    expect(JSON.stringify(calls[0]?.messages)).toContain('Unicode 文件 😀')
    expect(runtime.loadSession(session.id).messages[0]?.parts).toEqual(userMessage.parts)
    await writeFile(
      skillPath,
      '---\nname: manual\ndescription: Manual\ndisable-model-invocation: true\n---\nChanged manual instructions'
    )
    const reloaded = new SessionRuntimeService({ database })
    const second = collectEvents()
    const retried = await createConfiguredExecutor(async (input) => {
      calls.push(input)
      if (calls.length === 2)
        return streamFrom([
          // SAFETY: fixture matches the provider's completed tool-input chunk contract.
          {
            type: 'tool-input-available',
            toolCallId: 'resource',
            toolName: 'ReadSkillResource',
            input: { skill_id: 'manual', relative_path: 'reference.md' }
          } as UIMessageChunk
        ])
      return streamFrom([textChunk])
    }, reloaded)
    retried.startTurn(
      {
        ownerId: 'w',
        request: {
          ...request,
          requestId: 'retry-manual',
          sessionId: session.id,
          userMessage,
          retry: true
        }
      },
      second.emit
    )
    await second.terminal
    expect(second.events.at(-1)?.type).toBe('finish')
    expect(JSON.stringify(calls[1]?.messages)).toContain('Original manual instructions')
    expect(JSON.stringify(calls[1]?.messages)).not.toContain('Changed manual instructions')
    expect(
      calls[1]?.messages.filter((message) =>
        JSON.stringify(message).includes('Original manual instructions')
      )
    ).toHaveLength(1)
    expect(JSON.stringify(calls[2]?.messages)).toContain('Current manual reference')
    const observations = second.events.filter((event) => event.type === 'context-measurement')
    expect(observations).toHaveLength(2)
    expect(observations[0].measurement.estimatedInputTokens).toBeGreaterThan(100)
    expect(observations[1].measurement.estimatedInputTokens).toBeGreaterThan(
      observations[0].measurement.estimatedInputTokens
    )
  })

  it.each(['missing', 'hidden', 'no-workspace'])(
    'user invokes %s when starting a turn, then no provider request is made',
    async (scenario) => {
      const cwd = await createTemporaryWorkspace('mico-invalid-skill-')
      const base = join(cwd, '.agents/skills/hidden')
      await mkdir(base, { recursive: true })
      await writeFile(
        join(base, 'SKILL.md'),
        '---\nname: hidden\ndescription: Hidden\nuser-invocable: false\n---\nHidden body'
      )
      const { runtime, session } = await createSession(
        'Invalid skill',
        scenario === 'no-workspace' ? {} : { projectId: 'p', cwd }
      )
      const stream = vi.fn<ChatProvider['stream']>(async () => streamFrom([]))
      const executor = await createConfiguredExecutor(stream, runtime)
      const recorded = collectEvents()
      executor.startTurn(
        {
          ownerId: 'w',
          request: {
            ...request,
            sessionId: session.id,
            userMessage: {
              role: 'user',
              parts: [
                {
                  type: 'data-skill-invocation',
                  data: { skillId: `project-agents:${scenario}`, name: scenario, arguments: '' }
                }
              ]
            }
          }
        },
        recorded.emit
      )
      await recorded.terminal
      expect(stream).not.toHaveBeenCalled()
      expect(recorded.events.filter((event) => event.type !== 'context-measurement')).toEqual([
        expect.objectContaining({
          type: 'error',
          message: expect.stringMatching(/skill|workspace/i)
        })
      ])
    }
  )

  it('user sends a document-only message when starting a turn, then it is sent as named text', async () => {
    const { runtime, session } = await createSession('New chat')
    const calls: Parameters<ChatProvider['stream']>[0][] = []
    const titleGenerated = createDeferred()
    const recorded = collectEvents()
    const service = await createConfiguredExecutor(async (input) => {
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
    const service = await createExecutor(() =>
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
              { type: 'text', text: 'Focus on exported APIs.' }
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
          { type: 'text', text: 'Focus on exported APIs.' }
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
    const resolvedModelIds: string[] = []
    const models = await createModels(
      (selected) => {
        resolvedModelIds.push(selected.modelId)
        return createProvider(async () => streamFrom([]))
      },
      configuration,
      'session-model'
    )
    await models.saveLibrary({
      ...models.getLibrary(),
      models: [
        ...models.getLibrary().models,
        {
          id: 'global-model',
          provider: 'ollama',
          modelId: 'global-model-id',
          displayName: 'Global',
          enabled: true
        }
      ],
      selectedModelId: 'global-model'
    })
    const recorded = collectEvents()
    const service = new TurnExecutor({
      profiles: new SessionModelProfile({ models, runtime }),
      runtime
    })

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      recorded.emit
    )

    await recorded.terminal
    expect(resolvedModelIds).toEqual(['qwen3:8b'])
  })

  it('user sees an error when no enabled model is selected, then the run finishes with it', async () => {
    const recorded = collectEvents()
    const models = await createModels(() => createProvider(async () => streamFrom([])))
    await models.saveLibrary({ ...models.getLibrary(), selectedModelId: null })
    const { runtime } = await createRuntime([request.sessionId])
    runtime.createSession({ title: 'Session', defaultProfile: null })
    const profiles = new SessionModelProfile({ models, runtime })

    await expect(profiles.getCapabilities()).resolves.toBeNull()
    const service = new TurnExecutor({ profiles, runtime })
    service.startTurn({ ownerId: 'window-1', request }, recorded.emit)

    await recorded.terminal
    expect(recorded.events.filter((event) => event.type !== 'context-measurement')).toEqual([
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
    const service = await createExecutor(() => provider)

    service.startTurn({ ownerId: 'window-1', request }, recorded.emit)

    await recorded.terminal
    expect(recorded.events[0]).toEqual({
      type: 'context-measurement',
      requestId: 'request-1',
      measurement: { policyId: 'unicode-heuristic-v1', estimatedInputTokens: 3 }
    })
    expect(recorded.events.filter((event) => event.type !== 'context-measurement')).toEqual([
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
    const service = await createConfiguredExecutor(async () => streamFrom([textChunk]), runtime)

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
    const service = await createConfiguredExecutor(async ({ messages }) => {
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
    const service = await createConfiguredExecutor(
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
    const service = await createConfiguredExecutor(
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
    expect(recorded.events.filter((event) => event.type !== 'context-measurement')).toEqual([
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
    const service = await createConfiguredExecutor(
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
    expect(recorded.events.filter((event) => event.type !== 'context-measurement')).toEqual([
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
    const service = await createConfiguredExecutor(async () => streamFrom([]), runtime)

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
    const service = await createConfiguredExecutor(
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
      profile: new Models().toProfile(configuration, 'ollama:qwen3', 'default')
    })
    runtime.finishRun(failed.runId, {
      status: 'failed',
      failure: { code: 'provider_error', message: 'Failed' }
    })
    const recorded = collectEvents()
    const service = await createConfiguredExecutor(async () => streamFrom([textChunk]), runtime)

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
    const service = await createConfiguredExecutor(async ({ signal }) => {
      providerStarted.resolve()
      return pendingStream(signal)
    }, runtime)

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      () => undefined
    )
    await providerStarted.promise
    void service.abortTurn({ ownerId: 'window-1', requestId: request.requestId })
    await service.drain()

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
    const service = await createConfiguredExecutor(
      async ({ signal }) => partialPendingStream(signal),
      runtime
    )

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      recorded.emit
    )
    await recorded.firstChunk
    void service.abortTurn({ ownerId: 'window-1', requestId: request.requestId })
    await service.drain()

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
    const service = await createConfiguredExecutor(stream, runtime)

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
    const service = await createConfiguredExecutor(stream, runtime)
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
    const provider = createProvider(async ({ signal }) => {
      signals.set(String(signals.size + 1), signal)
      if (signals.size === 2) streamsStarted.resolve()
      return pendingStream(signal)
    })
    const service = await createExecutor(() => provider)

    service.startTurn({ ownerId: 'window-1', request }, (event) => events.push(event))
    service.startTurn(
      {
        ownerId: 'window-2',
        request: { ...request, sessionId: 'session-2', requestId: 'request-2' }
      },
      (event) => events.push(event)
    )
    await streamsStarted.promise

    const firstAbort = service.abortTurn({ ownerId: 'window-1', requestId: 'request-1' })
    const repeatedAbort = service.abortTurn({ ownerId: 'window-1', requestId: 'request-1' })

    expect(signals.get('1')?.aborted).toBe(true)
    expect(signals.get('2')?.aborted).toBe(false)
    await Promise.all([firstAbort, repeatedAbort])
    expect(events.filter((event) => event.type !== 'context-measurement')).toEqual([
      { type: 'cancelled', requestId: 'request-1' }
    ])
    service.dispose()
    await service.drain()
  })

  it('user keeps same-ID requests isolated when aborting one owner, then only that owner is aborted', async () => {
    const signals: AbortSignal[] = []
    const streamsStarted = createDeferred()
    const provider = createProvider(async ({ signal }) => {
      signals.push(signal)
      if (signals.length === 2) streamsStarted.resolve()
      return pendingStream(signal)
    })
    const service = await createExecutor(() => provider)

    service.startTurn({ ownerId: 'window-1', request }, () => undefined)
    service.startTurn(
      { ownerId: 'window-2', request: { ...request, sessionId: 'session-2' } },
      () => undefined
    )
    await streamsStarted.promise

    service.abortAllTurns('window-1')

    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)
    service.dispose()
    await service.drain()
  })

  it('user sees every active run aborted when the executor is disposed, then all signals abort', async () => {
    const signals: AbortSignal[] = []
    const streamsStarted = createDeferred()
    const provider = createProvider(async ({ signal }) => {
      signals.push(signal)
      if (signals.length === 2) streamsStarted.resolve()
      return pendingStream(signal)
    })
    const service = await createExecutor(() => provider)

    service.startTurn({ ownerId: 'window-1', request }, () => undefined)
    service.startTurn(
      {
        ownerId: 'window-2',
        request: { ...request, sessionId: 'session-2', requestId: 'request-2' }
      },
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
    const service = await createExecutor(() => createProvider(stream))

    service.startTurn({ ownerId: 'window-1', request }, recorded.emit)

    await recorded.terminal
    expect(recorded.events.filter((event) => event.type !== 'context-measurement')).toEqual([
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
    const service = await createExecutor(() => createProvider(stream), {
      maxAttempts: 2,
      retryDelayMs: 0
    })

    service.startTurn({ ownerId: 'window-1', request }, recorded.emit)

    await recorded.terminal
    expect(recorded.events.filter((event) => event.type !== 'context-measurement')).toEqual([
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
    const service = await createExecutor(() => provider, { maxAttempts: 2, retryDelayMs: 0 })

    service.startTurn({ ownerId: 'window-1', request }, recorded.emit)

    await recorded.terminal
    expect(recorded.events.filter((event) => event.type !== 'context-measurement')).toEqual([
      { type: 'chunk', requestId: 'request-1', chunk: textChunk },
      {
        type: 'error',
        requestId: 'request-1',
        message: "Couldn't connect to the API endpoint. Check the API URL, network, VPN, or proxy."
      }
    ])
  })

  it('user sees partial output when a persisted stream fails, then the stopped snapshot survives', async () => {
    const { runtime, session } = await createSession('Session')
    const recorded = collectEvents()
    const service = await createConfiguredExecutor(
      async () => ({
        async *[Symbol.asyncIterator]() {
          yield textChunk
          throw new TypeError('fetch failed')
        }
      }),
      runtime
    )
    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      recorded.emit
    )
    await recorded.terminal
    expect(runtime.loadSession(session.id).messages.at(-1)).toMatchObject({
      role: 'assistant',
      parts: [{ type: 'text', text: 'Hi' }],
      metadata: { completionState: 'stopped' }
    })
  })

  it('user gets the requested thinking effort when starting a turn, then it reaches the provider', async () => {
    const streamCalled = createDeferred()
    const stream = vi.fn<ChatProvider['stream']>(async () => {
      streamCalled.resolve()
      return streamFrom([])
    })
    const service = await createExecutor(() => ({
      stream,
      getModelCapabilities: async () => ({
        selectableEfforts: ['default', 'high'],
        defaultEffort: 'default'
      })
    }))

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
    const service = await createConfiguredExecutor(async (input) => {
      if (isTitleStream(input)) return streamFrom([])
      agentRequests += 1
      return agentRequests === 1
        ? streamFrom([
            // SAFETY: this fixture matches the provider's documented completed tool-call chunk.
            {
              type: 'tool-input-available',
              toolCallId: 'call-1',
              toolName: 'Read',
              input: { file_path: 'package.json', limit: 1 }
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
          toolName: 'Read',
          input: { path: 'package.json' },
          state: 'output-available',
          output: 'Read 1 line.'
        },
        { type: 'text', text: 'Done' }
      ]
    })
  })

  it('user runs a long task when tools need many rounds, then the final answer is saved', async () => {
    const { runtime, session } = await createSession('Project chat', {
      projectId: 'project-1',
      cwd: process.cwd()
    })
    let agentRequests = 0
    const recorded = collectEvents()
    const service = await createConfiguredExecutor(async (input) => {
      if (isTitleStream(input)) return streamFrom([])
      agentRequests += 1
      if (agentRequests === 31)
        return streamFrom([{ type: 'text-delta', id: 'final', delta: 'All work completed.' }])
      return streamFrom([
        // SAFETY: this fixture matches the provider's documented completed tool-call chunk.
        {
          type: 'tool-input-available',
          toolCallId: `call-${agentRequests}`,
          toolName: 'Read',
          input: { file_path: 'package.json', limit: 1 }
        } as UIMessageChunk
      ])
    }, runtime)

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      recorded.emit
    )
    await recorded.terminal

    expect(agentRequests).toBe(31)
    expect(recorded.events.some((event) => event.type === 'error')).toBe(false)
    expect(recorded.events.at(-1)?.type).toBe('finish')
    expect(runtime.loadSession(session.id).messages.at(-1)).toMatchObject({
      role: 'assistant',
      parts: expect.arrayContaining([{ type: 'text', text: 'All work completed.' }]),
      metadata: { completionState: 'complete' }
    })
  })

  it('user sees interim text between tool rounds when the turn is replayed, then the transcript keeps the stream order', async () => {
    const { runtime, session } = await createSession('Project chat', {
      projectId: 'project-1',
      cwd: process.cwd()
    })
    let agentRequests = 0
    const recorded = collectEvents()
    const service = await createConfiguredExecutor(async (input) => {
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
            toolName: 'Read',
            input: { file_path: 'package.json', limit: 1 }
          } as UIMessageChunk
        ])
      if (agentRequests === 2)
        return streamFrom([
          { type: 'text-delta', id: 'interim', delta: 'Found the entry point.' },
          // SAFETY: this fixture matches the provider's documented completed tool-call chunk.
          {
            type: 'tool-input-available',
            toolCallId: 'call-2',
            toolName: 'Read',
            input: { file_path: 'package.json', limit: 1 }
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

  it('user stops between tool rounds when output interleaves, then settled parts keep their order', async () => {
    const cwd = await createTemporaryWorkspace('mico-stopped-display-')
    await writeFile(join(cwd, 'a.txt'), 'File contents\n')
    const { database, runtime, session } = await createSession('Project chat', {
      projectId: 'project-1',
      cwd
    })
    const partialReceived = createDeferred()
    const streamStopped = createDeferred()
    const recorded = collectEvents()
    let agentRequests = 0
    const service = await createConfiguredExecutor(async (input) => {
      if (isTitleStream(input)) return streamFrom([])
      const { signal } = input
      agentRequests += 1
      if (agentRequests === 1)
        return streamFrom([
          { type: 'reasoning-start', id: 'reasoning-1' },
          { type: 'reasoning-delta', id: 'reasoning-1', delta: 'First thought.' },
          { type: 'reasoning-end', id: 'reasoning-1' },
          {
            type: 'tool-input-available',
            toolCallId: 'call-1',
            toolName: 'Read',
            input: { file_path: 'a.txt', limit: 1 },
            dynamic: true
          }
        ])
      if (agentRequests === 2)
        return streamFrom([
          { type: 'text-delta', id: 'interim', delta: 'Found the entry point.' },
          {
            type: 'tool-input-available',
            toolCallId: 'call-2',
            toolName: 'Read',
            input: { file_path: 'a.txt', limit: 1 },
            dynamic: true
          }
        ])
      return {
        async *[Symbol.asyncIterator](): AsyncIterator<UIMessageChunk> {
          const aborted = new Promise<void>((resolve) =>
            signal.addEventListener('abort', () => resolve(), { once: true })
          )
          yield { type: 'text-delta', id: 'partial', delta: 'Still investigating.' }
          await aborted
          streamStopped.resolve()
        }
      }
    }, runtime)

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      (event) => {
        recorded.emit(event)
        if (
          event.type === 'chunk' &&
          event.chunk.type === 'text-delta' &&
          event.chunk.id === 'partial'
        )
          partialReceived.resolve()
      }
    )
    await partialReceived.promise
    void service.abortTurn({ ownerId: 'window-1', requestId: request.requestId })
    await streamStopped.promise
    await service.drain()

    expect(runtime.loadSession(session.id).messages.at(-1)).toMatchObject({
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'First thought.' },
        {
          type: 'tool-trace',
          toolCallId: 'call-1',
          toolName: 'Read',
          state: 'output-available',
          output: 'Read 1 line.'
        },
        { type: 'text', text: 'Found the entry point.' },
        {
          type: 'tool-trace',
          toolCallId: 'call-2',
          toolName: 'Read',
          state: 'output-available',
          output: 'Read 1 line.'
        },
        { type: 'text', text: 'Still investigating.' }
      ],
      metadata: { completionState: 'stopped' }
    })
    expect(database.connection.prepare('SELECT status FROM runs').all()).toEqual([
      { status: 'cancelled' }
    ])
    expect(
      recorded.events.filter(
        (event) => event.type !== 'chunk' && event.type !== 'context-measurement'
      )
    ).toEqual([{ type: 'cancelled', requestId: request.requestId }])
  })

  it('user retries before output when project skills change, then one stable context drives the turn', async () => {
    const cwd = await createTemporaryWorkspace('mico-turn-skills-')
    const base = join(cwd, '.agents', 'skills', 'mico-turn-review')
    await mkdir(base, { recursive: true })
    const skillPath = join(base, 'SKILL.md')
    await writeFile(
      skillPath,
      '---\nname: mico-turn-review\ndescription: Review project\n---\nOriginal skill body'
    )
    await writeFile(join(cwd, 'AGENTS.md'), 'Original project guidance')
    const { runtime, session } = await createSession('Project chat', {
      projectId: 'project-1',
      cwd
    })
    const calls: Parameters<ChatProvider['stream']>[0][] = []
    const recorded = collectEvents()
    const service = await createConfiguredExecutor(
      async (input) => {
        if (isTitleStream(input)) return streamFrom([])
        calls.push(input)
        if (calls.length === 1) {
          await writeFile(
            skillPath,
            '---\nname: mico-turn-review\ndescription: Review project\n---\nChanged skill body'
          )
          await writeFile(join(cwd, 'AGENTS.md'), 'Changed project guidance')
          throw new TypeError('fetch failed')
        }
        if (calls.length === 2)
          return streamFrom([
            // SAFETY: this fixture conforms to the provider completed tool-call chunk.
            {
              type: 'tool-input-available',
              toolCallId: 'skill-call',
              toolName: 'LoadSkill',
              input: { skill_id: 'mico-turn-review' }
            } as UIMessageChunk
          ])
        return streamFrom([{ type: 'text-delta', id: 'answer', delta: 'Done.' }])
      },
      runtime,
      {
        maxAttempts: 2,
        retryDelayMs: 0
      }
    )
    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      recorded.emit
    )
    await recorded.terminal
    expect(recorded.events.at(-1)?.type).toBe('finish')
    for (const call of calls) {
      expect(call.messages.filter((message) => message.role === 'system')).toHaveLength(1)
      const context = JSON.stringify(call.messages)
      expect(context).toContain('Original project guidance')
      expect(context).not.toContain('Changed project guidance')
    }
    expect(calls[1]?.messages.slice(1, 2)).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'Hello' }] }
    ])
    expect(calls[1]?.messages.at(-1)).toMatchObject({
      role: 'user',
      parts: [
        {
          type: 'text',
          text: expect.stringContaining(
            'Context for the current user request; does not replace that request.'
          )
        }
      ]
    })
    expect(calls[1]?.tools?.some((tool) => tool.name === 'LoadSkill')).toBe(true)
    expect(JSON.stringify(calls[2]?.messages)).toContain('Original skill body')
    expect(JSON.stringify(calls[2]?.messages)).not.toContain('Changed skill body')
    const persisted = JSON.stringify(runtime.loadSession(session.id).messages)
    expect(persisted).not.toContain('Original project guidance')
    expect(persisted).toContain('Original skill body')
    const next = collectEvents()
    service.startTurn(
      {
        ownerId: 'window-1',
        request: { ...request, requestId: 'request-2', sessionId: session.id }
      },
      next.emit
    )
    await next.terminal
    expect(next.events.at(-1)?.type).toBe('finish')
    expect(JSON.stringify(calls.at(-1)?.messages)).toContain('Changed project guidance')
    expect(JSON.stringify(runtime.loadSession(session.id).messages)).toContain(
      'Original skill body'
    )
  })

  it('user gets workspace instructions prepended when in a project session, then they lead the request', async () => {
    const cwd = process.cwd()
    const { runtime, session } = await createSession('Project chat', {
      projectId: 'project-1',
      cwd
    })
    const calls: Parameters<ChatProvider['stream']>[0][] = []
    const recorded = collectEvents()
    const service = await createConfiguredExecutor(async (input) => {
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
    const service = await createConfiguredExecutor(
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
