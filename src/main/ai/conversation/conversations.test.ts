import type { ChatProvider, ChatProviderStreamInput, ProviderStreamPart } from '@mico/ai-providers'
import { providerFinish } from '@mico/ai-providers'
import type { TurnStartRequest, TurnStreamEvent } from '@shared/ipc/schemas/chat'
import { afterEach, describe, expect, it } from 'vitest'
import { Conversations } from './index'
import { createModels, createRuntime, isTitleStream, removeTemporaryPaths } from './test-helpers'

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

function userMessage(text: string): TurnStartRequest['userMessage'] {
  return { role: 'user', parts: [{ type: 'text', text }] }
}

describe('Conversations', () => {
  afterEach(removeTemporaryPaths)

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
      { role: 'user', parts: [{ type: 'text', text: 'Checkpoint summary of two turns.' }] },
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
