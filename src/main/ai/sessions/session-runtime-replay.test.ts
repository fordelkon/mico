import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type ChatProvider,
  type ChatProviderMessage,
  type ProviderStreamPart,
  providerFinish
} from '@mico/ai-providers'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionDatabase } from '../../data/session-database'
import { TurnDisplayAssembler } from '../chat/turn-display-assembler'
import { ToolAgentRunner } from '../tools/tool-agent-runner'
import { ToolRegistry } from '../tools/tool-registry'
import { SessionRuntimeService } from './session-runtime-service'

const profile = {
  modelEntryId: 'model',
  providerId: 'provider',
  modelId: 'model',
  thinkingEffort: 'default' as const,
  configurationDigest: 'digest'
}
const prompt = { role: 'user' as const, parts: [{ type: 'text' as const, text: 'Read the file.' }] }
const STEP_ONE_USAGE = { inputTokens: 100, outputTokens: 20, totalTokens: 120 }
const STEP_TWO_USAGE = { inputTokens: 200, outputTokens: 50, reasoningTokens: 10, totalTokens: 260 }
const databases: SessionDatabase[] = []
const paths: string[] = []
afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

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
function scripted(turns: ProviderStreamPart[][]): ChatProvider {
  let index = 0
  return {
    getModelCapabilities: async () => null,
    stream: async () =>
      (async function* () {
        yield* turns[index++]
      })()
  }
}
function response(
  text: string,
  id: string,
  reason: 'stop' | 'length' = 'stop'
): ProviderStreamPart[] {
  return [
    { type: 'text-delta', id, delta: text },
    providerFinish({
      reason,
      continuation: { provider: 'openai-responses', responseId: id }
    })
  ]
}

describe('Session runtime replay', () => {
  it('user retries after restart when context was accepted, then the original snapshot replays once', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mico-context-'))
    paths.push(directory)
    const database = new SessionDatabase({ getUserDataPath: () => directory })
    await database.initialize()
    const service = new SessionRuntimeService({ database })
    const session = service.createSession({ title: 'Context', defaultProfile: profile })
    const first = service.beginTurn({
      sessionId: session.id,
      requestId: 'first',
      userMessage: prompt,
      profile,
      retry: false
    })
    const context: Array<
      Extract<ChatProviderMessage, { role: 'system' | 'user' }> & { role: 'user' }
    > = [{ role: 'user', parts: [{ type: 'text', text: 'Accepted skill body: café' }] }]
    first.recordContext(context)
    first.recordContext(context)
    expect(() =>
      first.recordContext([{ role: 'user', parts: [{ type: 'text', text: 'Replacement' }] }])
    ).toThrow(/context.*accepted/i)
    first.fail({ code: 'provider_error', message: 'Offline' })
    database.close()

    const reopened = new SessionDatabase({ getUserDataPath: () => directory })
    databases.push(reopened)
    await reopened.initialize()
    const runtime = new SessionRuntimeService({ database: reopened })
    const retry = runtime.beginTurn({
      sessionId: session.id,
      requestId: 'retry',
      userMessage: prompt,
      profile,
      retry: true
    })
    expect(retry.contextMessages).toEqual(context)
    expect(retry.replayMessages).toEqual([prompt, ...context])
    retry.recordContext(context)
    expect(() => retry.recordContext([])).toThrow(/context.*accepted/i)
    const answer = {
      role: 'assistant' as const,
      parts: [{ type: 'text' as const, text: 'Answer' }]
    }
    retry.complete(answer)
    const next = runtime.beginTurn({
      sessionId: session.id,
      requestId: 'next',
      userMessage: prompt,
      profile,
      retry: false
    })
    expect(next.contextMessages).toBeUndefined()
    expect(next.replayMessages).toEqual([prompt, ...context, answer, prompt])
    expect(runtime.loadSession(session.id).messages).toEqual([prompt, answer, prompt])
    expect(
      reopened.connection
        .prepare("SELECT COUNT(*) FROM runtime_events WHERE kind = 'turn_context_recorded'")
        .pluck()
        .get()
    ).toBe(1)
  })

  it('user retries when context was never accepted, then the snapshot remains unaccepted', async () => {
    const { begin } = await setup()
    const first = begin('first')
    expect(first.contextMessages).toBeUndefined()
    first.fail({ code: 'provider_error', message: 'Offline' })

    const retry = begin('retry', true)

    expect(retry.contextMessages).toBeUndefined()
    expect(retry.replayMessages).toEqual([prompt])
    retry.recordContext([])
    retry.fail({ code: 'provider_error', message: 'Offline' })
    expect(begin('accepted-retry', true).contextMessages).toEqual([])
  })

  it('user accepts empty context when no skill is invoked, then retries cannot replace the snapshot', async () => {
    const { begin } = await setup()
    const first = begin('first')
    first.recordContext([])
    first.fail({ code: 'provider_error', message: 'Offline' })
    const retry = begin('retry', true)
    expect(retry.contextMessages).toEqual([])
    expect(() =>
      retry.recordContext([{ role: 'user', parts: [{ type: 'text', text: 'New body' }] }])
    ).toThrow(/context.*accepted/i)
    expect(retry.replayMessages).toEqual([prompt])
  })

  it('user continues after tools when starting another turn, then the final response identity remains', async () => {
    const { database, session, begin } = await setup()
    const cwd = await mkdtemp(join(tmpdir(), 'mico-replay-'))
    paths.push(cwd)
    await writeFile(join(cwd, 'a.txt'), 'contents')
    const handle = begin('first')
    const result = await new ToolAgentRunner().run({
      provider: scripted([
        [
          { type: 'text-delta', id: 'intro', delta: 'Inspecting.' },
          {
            type: 'tool-input-available',
            toolCallId: 'read',
            toolName: 'Read',
            input: { file_path: 'a.txt' },
            dynamic: true
          },
          providerFinish({
            reason: 'tool-calls',
            continuation: {
              provider: 'openai-responses',
              responseId: 'tool-response'
            }
          })
        ],
        response('Final answer.', 'final-response')
      ]),
      messages: handle.replayMessages,
      registry: ToolRegistry.forWorkspace(cwd),
      thinkingEffort: 'none',
      signal: new AbortController().signal,
      emit: () => undefined,
      onStep: handle.recordStep,
      onToolResult: handle.recordTrace
    })
    handle.complete({ role: 'assistant', parts: [{ type: 'text', text: result.assistantText }] })
    const reloaded = new SessionRuntimeService({ database })
    const next = reloaded.beginTurn({
      sessionId: session.id,
      requestId: 'next',
      userMessage: prompt,
      profile,
      retry: false
    })
    expect(next.replayMessages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
      'user'
    ])
    expect(next.replayMessages[2]).toMatchObject({ role: 'tool', parts: [{ output: 'contents' }] })
    expect(next.replayMessages[3]).toEqual(result.finalAssistant)
    expect(next.replayMessages[3]).toMatchObject({ replay: { responseId: 'final-response' } })
  })

  it.each(['completed', 'failed', 'cancelled'] as const)(
    'user resumes a %s answer when continuing, then recorded responses occur once',
    async (status) => {
      const { begin } = await setup()
      const handle = begin('first')
      const result = await new ToolAgentRunner().run({
        provider: scripted([response('Partial ', 'partial', 'length'), response('final', 'final')]),
        messages: handle.replayMessages,
        thinkingEffort: 'none',
        signal: new AbortController().signal,
        emit: () => undefined,
        onStep: handle.recordStep
      })
      const visible = {
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, text: result.assistantText }]
      }
      if (status === 'failed') handle.fail({ code: 'provider_error', message: 'Offline' })
      else if (status === 'cancelled') handle.cancel(visible)
      else handle.complete(visible)
      const next = begin('next', status === 'failed')
      expect(next.replayMessages).toEqual([
        prompt,
        {
          role: 'assistant',
          parts: [{ type: 'text', text: 'Partial ' }],
          replay: { provider: 'openai-responses', responseId: 'partial' }
        },
        {
          role: 'user',
          parts: [
            {
              type: 'text',
              text: 'Output token limit hit. Resume directly from where you stopped. Do not apologize or recap.'
            }
          ]
        },
        result.finalAssistant,
        ...(status === 'failed' ? [] : [prompt])
      ])
    }
  )

  it.each(['failed', 'cancelled'] as const)(
    'user stops an incomplete %s stream when continuing, then only settled responses replay',
    async (status) => {
      const { database, begin } = await setup()
      const handle = begin('first')
      let index = 0
      const provider: ChatProvider = {
        getModelCapabilities: async () => null,
        stream: async () =>
          (async function* () {
            if (index++ === 0) yield* response('Partial ', 'partial', 'length')
            else {
              yield { type: 'text-delta' as const, id: 'unfinished', delta: 'unfinished' }
              throw new Error('Stream interrupted')
            }
          })()
      }
      await expect(
        new ToolAgentRunner().run({
          provider,
          messages: handle.replayMessages,
          thinkingEffort: 'none',
          signal: new AbortController().signal,
          emit: () => undefined,
          onStep: handle.recordStep
        })
      ).rejects.toThrow('Stream interrupted')
      if (status === 'failed') handle.fail({ code: 'provider_error', message: 'Offline' })
      else
        handle.cancel({ role: 'assistant', parts: [{ type: 'text', text: 'Partial unfinished' }] })
      expect(
        database.connection
          .prepare(
            "SELECT COUNT(*) FROM runtime_events WHERE run_id = ? AND kind = 'agent_step_recorded'"
          )
          .pluck()
          .get(handle.runId)
      ).toBe(1)
      const messages = begin('next', status === 'failed').replayMessages
      expect(messages[1]).toMatchObject({ replay: { responseId: 'partial' } })
      expect(messages.filter((message) => message.role === 'assistant')).toEqual([
        {
          role: 'assistant',
          parts: [{ type: 'text', text: 'Partial ' }],
          replay: { provider: 'openai-responses', responseId: 'partial' }
        },
        ...(status === 'cancelled'
          ? [{ role: 'assistant', parts: [{ type: 'text', text: 'unfinished' }] }]
          : [])
      ])
    }
  )

  it('user retries after two output limits when the run fails, then both responses replay once', async () => {
    const { begin } = await setup()
    const handle = begin('first')
    await expect(
      new ToolAgentRunner().run({
        provider: scripted([response('One', 'one', 'length'), response('Two', 'two', 'length')]),
        messages: handle.replayMessages,
        thinkingEffort: 'none',
        signal: new AbortController().signal,
        emit: () => undefined,
        onStep: handle.recordStep
      })
    ).rejects.toThrow('output token limit twice')
    handle.fail({ code: 'token_limit', message: 'Output limit' })
    const messages = begin('retry', true).replayMessages
    expect(messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant'
    ])
    expect(messages[1]).toMatchObject({ replay: { responseId: 'one' } })
    expect(messages[3]).toMatchObject({ replay: { responseId: 'two' } })
  })

  it.each(['completed', 'cancelled'] as const)(
    'user continues a truncated %s reply when text was already recorded, then replay adds no duplicate',
    async (status) => {
      const { begin } = await setup()
      const handle = begin('first')
      const assembler = new TurnDisplayAssembler(8)
      const text = 'Inspecting the complete file.'
      assembler.appendText(text)
      const assistant: Extract<ChatProviderMessage, { role: 'assistant' }> = {
        role: 'assistant',
        parts: [
          { type: 'text', text },
          {
            type: 'tool-call',
            toolCallId: 'read',
            toolName: 'Read',
            argumentsJson: '{}'
          }
        ]
      }
      const tool = {
        type: 'tool-result' as const,
        toolCallId: 'read',
        toolName: 'Read',
        output: 'contents',
        isError: false
      }
      handle.recordStep({ index: 1, assistant, toolResults: [tool] })
      const visible = {
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, text: assembler.text() }]
      }
      expect(assembler.text()).toBe('Inspect…')
      if (status === 'completed') handle.complete(visible)
      else handle.cancel(visible)
      expect(begin('next').replayMessages).toEqual([
        prompt,
        assistant,
        { role: 'tool', parts: [tool] },
        prompt
      ])
    }
  )

  it('user continues legacy tool history when a final reply exists, then only new reply text is appended', async () => {
    const { service, begin } = await setup()
    const handle = begin('first')
    const assistant: Extract<ChatProviderMessage, { role: 'assistant' }> = {
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Inspecting.' },
        {
          type: 'tool-call',
          toolCallId: 'read',
          toolName: 'Read',
          argumentsJson: '{}'
        }
      ]
    }
    service.recordAgentStep(handle.runId, {
      index: 1,
      assistant,
      toolResults: [
        {
          type: 'tool-result',
          toolCallId: 'read',
          toolName: 'Read',
          output: 'contents',
          isError: false
        }
      ]
    })
    handle.complete({
      role: 'assistant',
      parts: [{ type: 'text', text: 'Inspecting.Final answer.' }]
    })
    expect(begin('next').replayMessages).toEqual([
      prompt,
      assistant,
      {
        role: 'tool',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'read',
            toolName: 'Read',
            output: 'contents',
            isError: false
          }
        ]
      },
      { role: 'assistant', parts: [{ type: 'text', text: 'Final answer.' }] },
      prompt
    ])
  })

  it('user keeps per-step usage across a restart when a run spans tool and final steps, then each accepted step records its own usage', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mico-usage-restart-'))
    paths.push(directory)
    const workspace = await mkdtemp(join(tmpdir(), 'mico-usage-workspace-'))
    paths.push(workspace)
    await writeFile(join(workspace, 'a.txt'), 'contents')
    const database = new SessionDatabase({ getUserDataPath: () => directory })
    databases.push(database)
    await database.initialize()
    const service = new SessionRuntimeService({ database })
    const session = service.createSession({ title: 'Usage', defaultProfile: profile })
    const handle = service.beginTurn({
      sessionId: session.id,
      requestId: 'first',
      userMessage: prompt,
      profile,
      retry: false
    })
    await new ToolAgentRunner().run({
      provider: scripted([
        [
          // SAFETY: this fixture matches the provider's documented completed tool-call chunk.
          {
            type: 'tool-input-available',
            toolCallId: 'read',
            toolName: 'Read',
            input: { file_path: 'a.txt' },
            dynamic: true
          },
          providerFinish({ reason: 'tool-calls', usage: STEP_ONE_USAGE })
        ],
        [
          { type: 'text-delta', id: 'final', delta: 'Final answer.' },
          providerFinish({ reason: 'stop', usage: STEP_TWO_USAGE })
        ]
      ]),
      messages: handle.replayMessages,
      registry: ToolRegistry.forWorkspace(workspace),
      thinkingEffort: 'none',
      signal: new AbortController().signal,
      emit: () => undefined,
      onStep: handle.recordStep,
      onToolResult: handle.recordTrace,
      journal: {
        recordModelStep: handle.recordModelStep,
        recordToolExecutionStarted: handle.recordToolExecutionStarted,
        recordToolExecutionSettled: handle.recordToolExecutionSettled
      }
    })
    handle.complete({
      role: 'assistant',
      parts: [{ type: 'text', text: 'Final answer.' }]
    })

    databases.splice(databases.indexOf(database), 1)
    database.close()
    const reopened = new SessionDatabase({ getUserDataPath: () => directory })
    databases.push(reopened)
    await reopened.initialize()
    const runtime = new SessionRuntimeService({ database: reopened })
    const accepted = reopened.connection
      .prepare(
        "SELECT payload_json FROM runtime_events WHERE kind = 'model_step_accepted' ORDER BY session_sequence"
      )
      .all()
      .map((row) => {
        // SAFETY: the fixed SELECT returns the journal's serialized payload column.
        return JSON.parse((row as { payload_json: string }).payload_json)
      })
    expect(accepted).toEqual([
      {
        index: 1,
        assistant: {
          role: 'assistant',
          parts: [
            {
              type: 'tool-call',
              toolCallId: 'read',
              toolName: 'Read',
              argumentsJson: '{"file_path":"a.txt"}'
            }
          ]
        },
        usage: STEP_ONE_USAGE
      },
      {
        index: 2,
        assistant: { role: 'assistant', parts: [{ type: 'text', text: 'Final answer.' }] },
        usage: STEP_TWO_USAGE
      }
    ])
    const next = runtime.beginTurn({
      sessionId: session.id,
      requestId: 'next',
      userMessage: prompt,
      profile,
      retry: false
    })
    expect(next.replayMessages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
      'user'
    ])
  })

  it('user gets one usage record when a model request fails before any chunk and retries, then the accepted step carries the retried attempt only', async () => {
    const { database, begin } = await setup()
    const handle = begin('first')
    let attempts = 0
    const provider: ChatProvider = {
      getModelCapabilities: async () => null,
      stream: async () => {
        if (++attempts === 1) throw new TypeError('fetch failed')
        return (async function* () {
          yield { type: 'text-delta' as const, id: 'answer', delta: 'done' }
          yield providerFinish({ reason: 'stop', usage: { inputTokens: 5, outputTokens: 3 } })
        })()
      }
    }
    await new ToolAgentRunner().run({
      provider,
      messages: handle.replayMessages,
      thinkingEffort: 'none',
      signal: new AbortController().signal,
      emit: () => undefined,
      journal: {
        recordModelStep: handle.recordModelStep,
        recordToolExecutionStarted: handle.recordToolExecutionStarted,
        recordToolExecutionSettled: handle.recordToolExecutionSettled
      }
    })
    handle.complete({ role: 'assistant', parts: [{ type: 'text', text: 'done' }] })

    const accepted = database.connection
      .prepare("SELECT payload_json FROM runtime_events WHERE kind = 'model_step_accepted'")
      .all()
      .map((row) => {
        // SAFETY: the fixed SELECT returns the journal's serialized payload column.
        return JSON.parse((row as { payload_json: string }).payload_json)
      })
    expect(accepted).toEqual([
      {
        index: 1,
        assistant: { role: 'assistant', parts: [{ type: 'text', text: 'done' }] },
        usage: { inputTokens: 5, outputTokens: 3 }
      }
    ])
  })

  it('user keeps completed step usage when cancelling after one step, then the cancelled run retains the recorded usage', async () => {
    const { database, begin } = await setup()
    const handle = begin('first')
    const controller = new AbortController()
    let requested = false
    const provider: ChatProvider = {
      getModelCapabilities: async () => null,
      stream: async () =>
        (async function* () {
          if (!requested) {
            requested = true
            yield { type: 'text-delta' as const, id: 'partial', delta: 'Partial ' }
            yield providerFinish({ reason: 'length', usage: { inputTokens: 11, outputTokens: 7 } })
            return
          }
          yield { type: 'text-delta' as const, id: 'unfinished', delta: 'unfinished' }
          controller.abort()
          throw new Error('Stream interrupted')
        })()
    }
    await expect(
      new ToolAgentRunner().run({
        provider,
        messages: handle.replayMessages,
        thinkingEffort: 'none',
        signal: controller.signal,
        emit: () => undefined,
        journal: {
          recordModelStep: handle.recordModelStep,
          recordToolExecutionStarted: handle.recordToolExecutionStarted,
          recordToolExecutionSettled: handle.recordToolExecutionSettled
        }
      })
    ).rejects.toThrow('aborted')
    handle.cancel({ role: 'assistant', parts: [{ type: 'text', text: 'Partial unfinished' }] })

    const accepted = database.connection
      .prepare("SELECT payload_json FROM runtime_events WHERE kind = 'model_step_accepted'")
      .all()
      .map((row) => {
        // SAFETY: the fixed SELECT returns the journal's serialized payload column.
        return JSON.parse((row as { payload_json: string }).payload_json)
      })
    expect(accepted).toEqual([
      {
        index: 1,
        assistant: { role: 'assistant', parts: [{ type: 'text', text: 'Partial ' }] },
        usage: { inputTokens: 11, outputTokens: 7 }
      }
    ])
  })

  it('user gets no usage recorded when the provider finishes without usage, then the accepted step stays usage-free', async () => {
    const { database, begin } = await setup()
    const handle = begin('first')
    await new ToolAgentRunner().run({
      provider: scripted([response('done', 'answer')]),
      messages: handle.replayMessages,
      thinkingEffort: 'none',
      signal: new AbortController().signal,
      emit: () => undefined,
      journal: {
        recordModelStep: handle.recordModelStep,
        recordToolExecutionStarted: handle.recordToolExecutionStarted,
        recordToolExecutionSettled: handle.recordToolExecutionSettled
      }
    })
    handle.complete({ role: 'assistant', parts: [{ type: 'text', text: 'done' }] })

    const accepted = database.connection
      .prepare("SELECT payload_json FROM runtime_events WHERE kind = 'model_step_accepted'")
      .all()
      .map((row) => {
        // SAFETY: the fixed SELECT returns the journal's serialized payload column.
        return JSON.parse((row as { payload_json: string }).payload_json)
      })
    expect(accepted).toEqual([
      {
        index: 1,
        assistant: {
          role: 'assistant',
          parts: [{ type: 'text', text: 'done' }],
          replay: { provider: 'openai-responses', responseId: 'answer' }
        }
      }
    ])
    expect(Object.hasOwn(accepted[0], 'usage')).toBe(false)
  })
})
