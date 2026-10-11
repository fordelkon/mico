import {
  type ChatProvider,
  type ChatProviderMessage,
  createChatProvider,
  ProviderError
} from '@mico/ai-providers'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionDatabase } from '../../data/session-database'
import { ToolAgentRunner } from '../tools/tool-agent-runner'
import { SessionRuntimeService } from './session-runtime-service'

const profile = {
  modelEntryId: 'model',
  providerId: 'provider',
  modelId: 'model',
  thinkingEffort: 'default' as const,
  configurationDigest: 'digest'
}
const prompt = { role: 'user' as const, parts: [{ type: 'text' as const, text: 'Read the file.' }] }
const databases: SessionDatabase[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})
const toolCallAssistant: Extract<ChatProviderMessage, { role: 'assistant' }> = {
  role: 'assistant',
  parts: [
    { type: 'tool-call', toolCallId: 'read', toolName: 'Read', argumentsJson: '{"file_path":"a"}' }
  ]
}
const toolResult = {
  type: 'tool-result' as const,
  toolCallId: 'read',
  toolName: 'Read',
  output: 'contents',
  isError: false
}
const toolCallSettlement = {
  index: 1,
  result: toolResult,
  trace: {
    toolCallId: 'read',
    toolName: 'Read',
    input: { file_path: 'a' },
    output: 'contents',
    isError: false,
    startedAt: 1,
    finishedAt: 2
  }
}

async function setup() {
  const database = new SessionDatabase({ getUserDataPath: () => ':memory:' })
  databases.push(database)
  await database.initialize()
  const service = new SessionRuntimeService({ database })
  const session = service.createSession({ title: 'Replay', defaultProfile: profile })
  const begin = (requestId: string, retry = false) =>
    service.beginTurn({
      sessionId: session.id,
      requestId,
      userMessage: prompt,
      profile,
      retry
    })
  return { database, service, session, begin }
}

describe('Checkpoint provider replay', () => {
  it.each(['journal', 'legacy'] as const)(
    'user resumes %s history when compacted, then summary reaches the provider before continuation',
    async (mode) => {
      const { database, service, session, begin } = await setup()
      begin('covered').complete({ role: 'assistant', parts: [{ type: 'text', text: 'Covered.' }] })
      const source = service.getCompactionSource(session.id)
      if (!source) throw new Error('Expected source.')
      const tail = begin('tail')
      const assistant: Extract<ChatProviderMessage, { role: 'assistant' }> = {
        ...toolCallAssistant,
        replay: { provider: 'openai-responses', responseId: 'old-chain' },
        providerMetadata: { vendor: { tag: 'retain' } },
        parts: [
          {
            type: 'reasoning',
            text: 'Reasoning.',
            providerMetadata: { anthropic: { signature: 'signed' } }
          },
          ...toolCallAssistant.parts
        ]
      }
      if (mode === 'journal') {
        tail.recordModelStep({ index: 1, assistant })
        tail.recordToolExecutionStarted({ index: 1, toolCallId: 'read', startedAt: 1 })
        tail.recordToolExecutionSettled(toolCallSettlement)
      } else tail.recordStep({ index: 1, assistant, toolResults: [toolResult] })
      const final = {
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, text: 'Tail.' }]
      }
      if (mode === 'journal') tail.recordModelStep({ index: 2, assistant: final })
      else tail.recordStep({ index: 2, assistant: final, toolResults: [] })
      tail.complete(final)
      const history = () =>
        database.connection.prepare('SELECT * FROM runtime_events ORDER BY session_sequence').all()
      const before = history()
      const transcript = service.loadSession(session.id).messages
      service.acceptContextCheckpoint({
        sessionId: session.id,
        summary: 'Summary.',
        coverage: { throughSequence: source.throughSequence },
        sourceDigest: source.sourceDigest
      })
      const current = begin('current')
      const bodies: unknown[] = []
      const provider = createChatProvider(
        { provider: 'openai-responses', baseUrl: 'https://example.test/v1', modelId: 'model' },
        {
          createId: () => 'id',
          fetch: async (_url, init) => {
            bodies.push(JSON.parse(String(init?.body)))
            return new Response(
              'event: response.completed\ndata: {"response":{"id":"new-chain"}}\n\n',
              { headers: { 'content-type': 'text/event-stream' } }
            )
          }
        }
      )
      const send = async (messages: ChatProviderMessage[]) => {
        for await (const _part of await provider.stream({
          messages,
          thinkingEffort: 'none',
          signal: new AbortController().signal
        })) {
          /* Consume the actual serialized request. */
        }
      }
      await send(current.replayMessages)
      expect(bodies[0]).toMatchObject({
        input: [
          { role: 'user', content: [{ type: 'input_text', text: 'Summary.' }] },
          { role: 'user', content: [{ type: 'input_text', text: 'Read the file.' }] },
          { role: 'assistant', content: [{ type: 'input_text', text: 'Reasoning.' }] },
          { type: 'function_call', call_id: 'read', name: 'Read', arguments: '{"file_path":"a"}' },
          { type: 'function_call_output', call_id: 'read', output: 'contents' },
          { role: 'assistant', content: [{ type: 'input_text', text: 'Tail.' }] },
          { role: 'user', content: [{ type: 'input_text', text: 'Read the file.' }] }
        ]
      })
      expect(bodies[0]).not.toHaveProperty('previous_response_id')
      expect(
        current.replayMessages.filter((message) => message.role === 'assistant')
      ).toContainEqual(
        expect.objectContaining({
          parts: assistant.parts,
          providerMetadata: assistant.providerMetadata
        })
      )
      current.fail({ code: 'provider_error', message: 'Offline' })
      const retry = begin('retry', true)
      expect(retry.replayMessages).toEqual(current.replayMessages)
      await send(retry.replayMessages)
      expect(bodies[1]).toEqual(bodies[0])
      expect(history().slice(0, before.length)).toEqual(before)
      expect(service.loadSession(session.id).messages).toEqual([...transcript, prompt])
      retry.recordModelStep({
        index: 1,
        assistant: {
          role: 'assistant',
          parts: [{ type: 'text', text: 'New.' }],
          replay: { provider: 'openai-responses', responseId: 'new-chain' }
        }
      })
      retry.complete({ role: 'assistant', parts: [{ type: 'text', text: 'New.' }] })
      await send(begin('next').replayMessages)
      expect(bodies[2]).toMatchObject({
        previous_response_id: 'new-chain',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'Read the file.' }] }]
      })
    }
  )

  it('user exceeds context after compaction when sending, then history and retry remain intact', async () => {
    const { database, service, session, begin } = await setup()
    begin('covered').complete({ role: 'assistant', parts: [{ type: 'text', text: 'Original.' }] })
    const source = service.getCompactionSource(session.id)
    if (!source) throw new Error('Expected source.')
    service.acceptContextCheckpoint({
      sessionId: session.id,
      summary: 'Summary.',
      coverage: { throughSequence: source.throughSequence },
      sourceDigest: source.sourceDigest
    })
    const current = begin('current')
    const history = database.connection
      .prepare('SELECT * FROM runtime_events ORDER BY session_sequence')
      .all()
    const transcript = service.loadSession(session.id).messages
    let requests = 0
    const provider: ChatProvider = {
      getModelCapabilities: async () => null,
      stream: async () => {
        requests += 1
        throw new ProviderError('context_overflow')
      }
    }
    await expect(
      new ToolAgentRunner().run({
        provider,
        messages: current.replayMessages,
        thinkingEffort: 'none',
        signal: new AbortController().signal,
        emit: () => undefined,
        journal: {
          recordModelStep: current.recordModelStep,
          recordToolExecutionStarted: current.recordToolExecutionStarted,
          recordToolExecutionSettled: current.recordToolExecutionSettled
        }
      })
    ).rejects.toThrow('context limit')
    expect(requests).toBe(1)
    expect(
      database.connection.prepare('SELECT * FROM runtime_events ORDER BY session_sequence').all()
    ).toEqual(history)
    current.fail({ code: 'provider_error', message: new ProviderError('context_overflow').message })
    expect(service.loadSession(session.id).messages).toEqual(transcript)
    expect(service.loadSession(session.id).recovery).toMatchObject({
      canRetry: true,
      failure: { message: new ProviderError('context_overflow').message }
    })
    expect(begin('retry', true).replayMessages).toEqual(current.replayMessages)
  })
})
