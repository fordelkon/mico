import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChatProvider, ChatProviderStreamInput, ProviderStreamPart } from '@mico/ai-providers'
import { providerFinish } from '@mico/ai-providers'
import type { TurnStartRequest, TurnStreamEvent } from '@mico/coding-agent/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { Conversations } from './index'
import {
  createModels,
  createRuntime,
  createTemporaryWorkspace,
  isTitleStream,
  removeTemporaryPaths
} from './test-helpers'

async function* response(text: string): AsyncIterable<ProviderStreamPart> {
  yield { type: 'text-delta', id: 'answer', delta: text }
  yield providerFinish({ reason: 'stop', usage: { inputTokens: 10, outputTokens: 2 } })
}

function runTurn(
  conversations: Conversations,
  request: TurnStartRequest
): Promise<TurnStreamEvent[]> {
  return new Promise((resolve) => {
    const events: TurnStreamEvent[] = []
    conversations.startTurn({ ownerId: 'window', request }, (event) => {
      events.push(event)
      if (event.type === 'finish' || event.type === 'error' || event.type === 'cancelled')
        resolve(events)
    })
  })
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function isSummaryStream(input: ChatProviderStreamInput): boolean {
  const first = input.messages[0]?.parts[0]
  return (
    input.messages[0]?.role === 'system' &&
    first?.type === 'text' &&
    first.text.includes('conversation summary generator')
  )
}

function userMessage(text: string): TurnStartRequest['userMessage'] {
  return { role: 'user', parts: [{ type: 'text', text }] }
}

interface InputBudgetScenario {
  budget: number | false
  outcome: 'error' | 'finish'
  calls: number
}

describe('Conversations', () => {
  afterEach(removeTemporaryPaths)

  it.each([
    { budget: 10, outcome: 'error', calls: 0 },
    { budget: false, outcome: 'finish', calls: 1 }
  ] satisfies InputBudgetScenario[])(
    'user configures $budget when a first request exceeds policy, then it ends with $outcome',
    async ({ budget, outcome, calls }) => {
      let providerCalls = 0
      const models = await createModels(() => ({
        getModelCapabilities: async () => null,
        stream: async (input) => {
          if (isTitleStream(input)) return response('Discussion')
          providerCalls += 1
          return response('Answer')
        }
      }))
      const { database } = await createRuntime()
      const conversations = new Conversations({
        database,
        models,
        applicationInputBudgetTokens: budget
      })
      const session = conversations.createSession({ title: 'Session', defaultProfile: null })
      const events = await runTurn(conversations, {
        sessionId: session.id,
        requestId: 'first',
        userMessage: userMessage('A'.repeat(200))
      })
      expect(events.at(-1)?.type).toBe(outcome)
      expect(providerCalls).toBe(calls)
      expect(
        database.connection.prepare('SELECT id FROM turns WHERE session_id = ?').all(session.id)
      ).toHaveLength(calls)
      await conversations.drain()
    }
  )

  it.each([
    { budget: false, outcome: 'finish', calls: 1 },
    { budget: 10, outcome: 'error', calls: 0 }
  ] satisfies InputBudgetScenario[])(
    'user switches models during capability lookup when admission ends with $outcome, then the newer choice survives',
    async ({ budget, outcome, calls }) => {
      const started = deferred<void>()
      const released = deferred<null>()
      const calledModels: string[] = []
      const models = await createModels((configuration) => ({
        getModelCapabilities: async () => {
          started.resolve()
          return released.promise
        },
        stream: async (input) => {
          if (isTitleStream(input)) return response('Model choice')
          calledModels.push(configuration.modelId)
          return response('Answer')
        }
      }))
      await models.saveLibrary({
        ...models.getLibrary(),
        models: [
          ...models.getLibrary().models,
          {
            id: 'other',
            provider: 'ollama',
            modelId: 'other-model',
            displayName: 'Other',
            enabled: true
          }
        ]
      })
      const { database } = await createRuntime()
      const conversations = new Conversations({
        database,
        models,
        applicationInputBudgetTokens: budget
      })
      const session = conversations.createSession({ title: 'Session', defaultProfile: null })
      try {
        const pending = runTurn(conversations, {
          sessionId: session.id,
          requestId: 'waiting-capabilities',
          userMessage: userMessage('A'.repeat(200))
        })
        await started.promise
        conversations.setSessionModelEntry(session.id, 'other')
        released.resolve(null)
        expect((await pending).at(-1)?.type).toBe(outcome)
        expect(conversations.loadSession(session.id).defaultProfile?.modelEntryId).toBe('other')
        expect(calledModels).toEqual(calls ? ['qwen3:8b'] : [])
      } finally {
        released.resolve(null)
        await conversations.drain()
      }
    }
  )

  it('user sends over budget when prior turns can compact, then the new pin preserves captured sources', async () => {
    const cwd = await createTemporaryWorkspace('mico-auto-compaction-')
    const skillDirectory = join(cwd, '.agents', 'skills', 'review')
    await mkdir(skillDirectory, { recursive: true })
    const skillPath = join(skillDirectory, 'SKILL.md')
    const skillHeader = '---\nname: review\ndescription: Review changes\n---\n'
    await writeFile(skillPath, `${skillHeader}Original skill evidence`)
    await writeFile(join(cwd, 'AGENTS.md'), 'Original project guidance')
    const requests: ChatProviderStreamInput[] = []
    const summaries: ChatProviderStreamInput[] = []
    const models = await createModels(() => ({
      getModelCapabilities: async () => null,
      stream: async (input) => {
        if (isTitleStream(input)) return response('Long discussion')
        if (isSummaryStream(input)) {
          summaries.push(input)
          await writeFile(skillPath, `${skillHeader}Changed skill evidence`)
          await writeFile(join(cwd, 'AGENTS.md'), 'Changed project guidance')
          return response('The earlier facts remain relevant.')
        }
        requests.push(input)
        return response(requests.length === 1 ? 'B'.repeat(120_000) : 'Reviewed')
      }
    }))
    const { database } = await createRuntime()
    const conversations = new Conversations({ database, models })
    const session = conversations.createSession({
      title: 'Session',
      defaultProfile: null,
      projectId: 'project',
      cwd
    })
    expect(
      (
        await runTurn(conversations, {
          sessionId: session.id,
          requestId: 'first',
          userMessage: userMessage('A'.repeat(120_000))
        })
      ).at(-1)?.type
    ).toBe('finish')
    const events = await runTurn(conversations, {
      sessionId: session.id,
      requestId: 'pending',
      userMessage: {
        role: 'user',
        parts: [
          { type: 'text', text: 'Review the pending changes' },
          {
            type: 'data-skill-invocation',
            data: {
              skillId: 'project-agents:review',
              name: 'review',
              arguments: 'pending'
            }
          }
        ]
      }
    })
    expect(events.at(-1)?.type).toBe('finish')
    expect(summaries).toHaveLength(1)
    const pendingInput = JSON.stringify(requests[1].messages)
    expect(pendingInput).toContain('The earlier facts remain relevant.')
    expect(pendingInput).toContain('Original skill evidence')
    expect(pendingInput).toContain('Original project guidance')
    expect(pendingInput).not.toContain('Changed skill evidence')
    expect(pendingInput).not.toContain('Changed project guidance')
    expect(requests[1].tools?.length).toBeGreaterThan(0)
    expect(
      database.connection
        .prepare(
          "SELECT json_extract(payload_json, '$.trigger') AS trigger FROM runtime_events WHERE kind = 'context_checkpoint_recorded'"
        )
        .all()
    ).toEqual([{ trigger: 'auto' }])
    expect(
      database.connection
        .prepare('SELECT checkpoint_event_id FROM turns WHERE session_id = ? ORDER BY ordinal')
        .all(session.id)
    ).toEqual([{ checkpoint_event_id: null }, { checkpoint_event_id: expect.any(String) }])
    expect(conversations.loadSession(session.id).messages[0].parts[0]).toEqual({
      type: 'text',
      text: 'A'.repeat(120_000)
    })
    await conversations.drain()
  })

  it('user remains over budget when a summary is accepted, then one attempt leaves the new turn unaccepted', async () => {
    let summaryCount = 0
    let turnCount = 0
    const models = await createModels(() => ({
      getModelCapabilities: async () => null,
      stream: async (input) => {
        if (isTitleStream(input)) return response('Discussion')
        if (isSummaryStream(input)) {
          summaryCount += 1
          return response('Summary'.repeat(600))
        }
        turnCount += 1
        return response('B'.repeat(3_000))
      }
    }))
    const { database } = await createRuntime()
    const conversations = new Conversations({
      database,
      models,
      applicationInputBudgetTokens: 1_000
    })
    const session = conversations.createSession({ title: 'Session', defaultProfile: null })
    await runTurn(conversations, {
      sessionId: session.id,
      requestId: 'first',
      userMessage: userMessage('A'.repeat(2_000))
    })
    const pending = {
      sessionId: session.id,
      requestId: 'pending',
      userMessage: userMessage('Continue')
    }
    const events = await runTurn(conversations, pending)
    expect(events.filter((event) => event.type === 'error')).toEqual([
      expect.objectContaining({ message: expect.stringMatching(/application input budget/i) })
    ])
    expect(summaryCount).toBe(1)
    expect(turnCount).toBe(1)
    expect(
      database.connection.prepare('SELECT id FROM turns WHERE session_id = ?').all(session.id)
    ).toHaveLength(1)
    const repeated = await runTurn(conversations, { ...pending, requestId: 'repeated' })
    expect(repeated.at(-1)?.type).toBe('error')
    expect(summaryCount).toBe(1)
    expect(conversations.loadSession(session.id).messages).toHaveLength(2)
    await conversations.drain()
  })

  it('user cancels admission when its summary is pending, then the durable notice releases the session', async () => {
    const acquired = deferred<ChatProviderStreamInput>()
    const release = deferred<void>()
    let turnCount = 0
    const models = await createModels(() => ({
      getModelCapabilities: async () => null,
      stream: async (input) => {
        if (isTitleStream(input)) return response('Discussion')
        if (isSummaryStream(input)) {
          acquired.resolve(input)
          await release.promise
          return response('Late summary')
        }
        turnCount += 1
        return response('B'.repeat(3_000))
      }
    }))
    const { database } = await createRuntime()
    const conversations = new Conversations({
      database,
      models,
      applicationInputBudgetTokens: 1_000
    })
    const session = conversations.createSession({ title: 'Session', defaultProfile: null })
    await runTurn(conversations, {
      sessionId: session.id,
      requestId: 'first',
      userMessage: userMessage('A'.repeat(2_000))
    })
    const request = {
      sessionId: session.id,
      requestId: 'pending',
      userMessage: userMessage('Continue')
    }
    const pending = runTurn(conversations, request)
    const summary = await acquired.promise
    expect(() =>
      conversations.startTurn(
        {
          ownerId: 'other-window',
          request: { ...request, requestId: 'concurrent' }
        },
        () => undefined
      )
    ).toThrow(/active request/i)
    await expect(conversations.compact(session.id)).rejects.toThrow(/active request/i)
    expect(() => conversations.deleteSession(session.id)).toThrow(/active request/i)
    const acknowledgement = conversations.abortTurn({ ownerId: 'window', requestId: 'pending' })
    expect(summary.signal.aborted).toBe(true)
    release.resolve()
    await acknowledgement
    expect((await pending).at(-1)?.type).toBe('cancelled')
    expect(
      database.connection
        .prepare(
          "SELECT json_extract(payload_json, '$.reason') AS reason FROM runtime_events WHERE kind = 'compaction_notice_recorded'"
        )
        .all()
    ).toEqual([{ reason: 'cancelled' }])
    expect(
      database.connection
        .prepare("SELECT id FROM runtime_events WHERE kind = 'context_checkpoint_recorded'")
        .all()
    ).toEqual([])
    expect(
      database.connection.prepare('SELECT id FROM turns WHERE session_id = ?').all(session.id)
    ).toHaveLength(1)
    expect(turnCount).toBe(1)
    conversations.deleteSession(session.id)
    await conversations.drain()
  })

  it('user retries after a newer checkpoint when its summary exceeds budget, then the original pin still replays', async () => {
    let fail = true
    let summaries = 0
    const requests: ChatProviderStreamInput[] = []
    const models = await createModels(() => ({
      getModelCapabilities: async () => null,
      stream: async (input) => {
        if (isTitleStream(input)) return response('Retry')
        if (isSummaryStream(input)) {
          summaries += 1
          return response('Checkpoint '.repeat(500))
        }
        requests.push(input)
        if (requests.length === 2 && fail) {
          fail = false
          throw new Error('External provider failure')
        }
        return response('Answer')
      }
    }))
    const { database } = await createRuntime()
    const conversations = new Conversations({
      database,
      models,
      maxAttempts: 1,
      applicationInputBudgetTokens: 1_000
    })
    const session = conversations.createSession({ title: 'Session', defaultProfile: null })
    await runTurn(conversations, {
      sessionId: session.id,
      requestId: 'prefix',
      userMessage: userMessage('Original prefix')
    })
    const request = {
      sessionId: session.id,
      requestId: 'failed',
      userMessage: userMessage('Try this')
    }
    expect((await runTurn(conversations, request)).at(-1)?.type).toBe('error')
    const recovery = conversations.loadSession(session.id).recovery
    await expect(conversations.compact(session.id)).resolves.toMatchObject({ status: 'accepted' })
    expect(
      (
        await runTurn(conversations, {
          ...request,
          requestId: 'retry',
          retryRunId: recovery!.runId
        })
      ).at(-1)?.type
    ).toBe('finish')
    expect(summaries).toBe(1)
    expect(JSON.stringify(requests[2].messages)).toContain('Original prefix')
    expect(JSON.stringify(requests[2].messages)).not.toContain('Checkpoint ')
    expect(
      database.connection
        .prepare('SELECT checkpoint_event_id FROM turns WHERE session_id = ? ORDER BY ordinal')
        .all(session.id)
    ).toEqual([{ checkpoint_event_id: null }, { checkpoint_event_id: null }])
    await conversations.drain()
  })

  it('user summarizes completed turns when continuing a conversation, then replay uses the checkpoint and display keeps history', async () => {
    const requests: ChatProviderStreamInput[] = []
    const provider: ChatProvider = {
      getModelCapabilities: async () => null,
      stream: async (input) => {
        if (isTitleStream(input)) return response('Recognize the conversation')
        const first = input.messages[0]?.parts[0]
        if (
          input.messages[0]?.role === 'system' &&
          first?.type === 'text' &&
          first.text.includes('conversation summary generator')
        )
          return response('Checkpoint summary of two turns.')
        requests.push(input)
        return response(`Answer ${requests.length}.`)
      }
    }
    const models = await createModels(() => provider)
    const { database } = await createRuntime()
    const conversations = new Conversations({ database, models })
    const session = conversations.createSession({ title: 'Session', defaultProfile: null })
    for (const [index, text] of ['First question', 'Second question'].entries()) {
      const events = await runTurn(conversations, {
        sessionId: session.id,
        requestId: `request-${index}`,
        userMessage: userMessage(text)
      })
      expect(events.at(-1)?.type).toBe('finish')
    }
    expect(requests[1].messages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'First question' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'Answer 1.' }] },
      { role: 'user', parts: [{ type: 'text', text: 'Second question' }] }
    ])
    await expect(conversations.compact(session.id)).resolves.toMatchObject({ status: 'accepted' })
    const continued = await runTurn(conversations, {
      sessionId: session.id,
      requestId: 'continued',
      userMessage: userMessage('Continue')
    })
    expect(continued.at(-1)?.type).toBe('finish')
    expect(requests[2].messages).toEqual([
      {
        role: 'user',
        parts: [
          {
            type: 'text',
            text: expect.stringMatching(
              /^Historical conversation checkpoint:.*Checkpoint summary of two turns\./s
            )
          }
        ]
      },
      { role: 'user', parts: [{ type: 'text', text: 'Continue' }] }
    ])
    expect(
      conversations.loadSession(session.id).messages.map((message) => message.parts[0])
    ).toEqual([
      { type: 'text', text: 'First question' },
      { type: 'text', text: 'Answer 1.' },
      { type: 'text', text: 'Second question' },
      { type: 'text', text: 'Answer 2.' },
      { type: 'text', text: 'Continue' },
      { type: 'text', text: 'Answer 3.' }
    ])
    const usage = database.connection
      .prepare(
        "SELECT json_extract(payload_json, '$.usage.inputTokens') AS inputTokens FROM runtime_events WHERE kind = 'model_step_accepted'"
      )
      .all()
    expect(usage).toEqual([{ inputTokens: 10 }, { inputTokens: 10 }, { inputTokens: 10 }])
    conversations.stopCompactions()
    await conversations.drain()
    conversations.dispose()
  })

  it('user retries when another session model is selected, then recovery keeps the original model and saved preference', async () => {
    const calledModels: string[] = []
    let fail = true
    const models = await createModels((configuration) => ({
      getModelCapabilities: async () => null,
      stream: async (input) => {
        if (isTitleStream(input)) return response('Retry the request')
        calledModels.push(configuration.modelId)
        if (fail) {
          fail = false
          throw new Error('External provider failure')
        }
        return response('Recovered')
      }
    }))
    await models.saveLibrary({
      ...models.getLibrary(),
      models: [
        ...models.getLibrary().models,
        {
          id: 'other',
          provider: 'ollama',
          modelId: 'other-model',
          displayName: 'Other',
          enabled: true
        }
      ]
    })
    const { database } = await createRuntime()
    const conversations = new Conversations({ database, models, maxAttempts: 1 })
    const session = conversations.createSession({ title: 'Session', defaultProfile: null })
    const request = {
      sessionId: session.id,
      requestId: 'first',
      userMessage: userMessage('Try this')
    }
    expect((await runTurn(conversations, request)).at(-1)?.type).toBe('error')
    const failed = conversations.loadSession(session.id).recovery
    expect(failed?.canRetry).toBe(true)
    conversations.setSessionModelEntry(session.id, 'other')
    const events = await runTurn(conversations, {
      ...request,
      requestId: 'retry',
      retryRunId: failed!.runId
    })
    expect(events.at(-1)?.type).toBe('finish')
    expect(calledModels).toEqual(['qwen3:8b', 'qwen3:8b'])
    expect(conversations.loadSession(session.id)).toMatchObject({
      defaultProfile: { modelEntryId: 'other' },
      recovery: null,
      messages: [
        { role: 'user', parts: [{ type: 'text', text: 'Try this' }] },
        { role: 'assistant', parts: [{ type: 'text', text: 'Recovered' }] }
      ]
    })
    await conversations.drain()
    conversations.dispose()
  })
})
