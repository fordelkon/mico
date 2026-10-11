import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionDatabase } from '../../data/session-database'
import { SessionRuntimeService } from './session-runtime-service'

const databases: SessionDatabase[] = []
const paths: string[] = []
afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
const profile = {
  modelEntryId: 'model',
  providerId: 'provider',
  modelId: 'model',
  thinkingEffort: 'default' as const,
  configurationDigest: 'digest'
}
const userMessage = { role: 'user' as const, parts: [{ type: 'text' as const, text: 'Read' }] }
async function setup(directory = ':memory:') {
  const database = new SessionDatabase({ getUserDataPath: () => directory })
  databases.push(database)
  await database.initialize()
  const service = new SessionRuntimeService({ database })
  const session = service.createSession({ title: 'Recovery', defaultProfile: profile })
  const run = service.beginTurn({
    sessionId: session.id,
    requestId: 'first',
    userMessage,
    profile,
    retry: false
  })
  return { database, service, session, run }
}
const assistant = {
  role: 'assistant' as const,
  parts: [
    {
      type: 'tool-call' as const,
      toolCallId: 'read',
      toolName: 'Read',
      argumentsJson: '{"file_path":"a"}'
    }
  ]
}
describe('Session recovery', () => {
  it('user repeats a retry request when its source changes, then the reused request is rejected', async () => {
    const { service, session, run } = await setup()
    run.fail({ code: 'provider_error', message: 'Offline' })
    const retry = service.retryTurn({
      sessionId: session.id,
      requestId: 'retry',
      userMessage,
      retryRunId: run.runId
    })
    expect(() =>
      service.retryTurn({
        sessionId: session.id,
        requestId: 'retry',
        userMessage,
        retryRunId: 'different'
      })
    ).toThrow(/retry source/i)
    expect(
      service.retryTurn({
        sessionId: session.id,
        requestId: 'retry',
        userMessage,
        retryRunId: run.runId
      }).runId
    ).toBe(retry.runId)
  })
  it('user continues after legacy history when restarting, then later steps replay once', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mico-journal-reopen-'))
    paths.push(directory)
    const { database, service, session, run } = await setup(directory)
    run.complete({ role: 'assistant', parts: [{ type: 'text', text: 'Legacy answer' }] })
    const current = service.beginTurn({
      sessionId: session.id,
      requestId: 'second',
      userMessage,
      profile,
      retry: false
    })
    expect(current.replayMessages).toEqual([
      userMessage,
      { role: 'assistant', parts: [{ type: 'text', text: 'Legacy answer' }] },
      userMessage
    ])
    current.recordModelStep({ index: 1, assistant })
    current.recordToolExecutionStarted({ index: 1, toolCallId: 'read', startedAt: 1 })
    current.recordToolExecutionSettled({
      index: 1,
      result: {
        type: 'tool-result',
        toolCallId: 'read',
        toolName: 'Read',
        output: 'contents',
        isError: false
      },
      trace: {
        toolCallId: 'read',
        toolName: 'Read',
        input: { file_path: 'a' },
        output: 'contents',
        isError: false,
        startedAt: 1,
        finishedAt: 2
      }
    })
    current.fail(
      { code: 'provider_error', message: 'Offline' },
      { role: 'assistant', parts: [{ type: 'text', text: 'Partial' }] }
    )
    databases.splice(databases.indexOf(database), 1)
    database.close()
    const reopened = new SessionDatabase({ getUserDataPath: () => directory })
    databases.push(reopened)
    await reopened.initialize()
    const restored = new SessionRuntimeService({ database: reopened })
    expect(restored.loadSession(session.id).messages.at(-1)).toMatchObject({
      metadata: { completionState: 'stopped' },
      parts: [
        expect.objectContaining({ type: 'tool-trace', toolCallId: 'read' }),
        { type: 'text', text: 'Partial' }
      ]
    })
    const retry = restored.beginTurn({
      sessionId: session.id,
      requestId: 'retry',
      userMessage,
      profile,
      retry: true,
      retryRunId: current.runId
    })
    expect(retry.replayMessages).toEqual([
      userMessage,
      { role: 'assistant', parts: [{ type: 'text', text: 'Legacy answer' }] },
      userMessage,
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
      }
    ])
    retry.complete({ role: 'assistant', parts: [{ type: 'text', text: 'Final' }] })
    const next = restored.beginTurn({
      sessionId: session.id,
      requestId: 'next',
      userMessage,
      profile,
      retry: false
    })
    expect(next.replayMessages).toEqual([
      userMessage,
      { role: 'assistant', parts: [{ type: 'text', text: 'Legacy answer' }] },
      userMessage,
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
      { role: 'assistant', parts: [{ type: 'text', text: 'Final' }] },
      userMessage
    ])
  })
  it('user retries when execution never started, then an error observation replaces dispatch', async () => {
    const { service, session, run } = await setup()
    run.recordModelStep({ index: 1, assistant })
    run.fail(
      { code: 'provider_error', message: 'Offline' },
      { role: 'assistant', parts: [{ type: 'text', text: 'Partial' }] }
    )
    expect(service.loadSession(session.id)).toMatchObject({
      recovery: { runId: run.runId, canRetry: true },
      messages: [userMessage, { role: 'assistant', metadata: { completionState: 'stopped' } }]
    })
    const retry = service.beginTurn({
      sessionId: session.id,
      requestId: 'retry',
      userMessage,
      profile,
      retry: true,
      retryRunId: run.runId
    })
    expect(retry.replayMessages).toEqual([
      userMessage,
      assistant,
      { role: 'tool', parts: [expect.objectContaining({ toolCallId: 'read', isError: true })] }
    ])
  })
  it('user restores an interrupted execution when its outcome is unknown, then retry is blocked', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mico-unknown-reopen-'))
    paths.push(directory)
    const { database, session, run } = await setup(directory)
    run.recordModelStep({ index: 1, assistant })
    run.recordToolExecutionStarted({ index: 1, toolCallId: 'read', startedAt: 1 })
    run.recordToolExecutionSettled({
      index: 1,
      result: {
        type: 'tool-result',
        toolCallId: 'read',
        toolName: 'Read',
        output: 'contents',
        isError: false
      },
      trace: {
        toolCallId: 'read',
        toolName: 'Read',
        input: { file_path: 'a' },
        output: 'contents',
        isError: false,
        startedAt: 1,
        finishedAt: 2
      }
    })
    run.recordModelStep({ index: 2, assistant })
    run.recordToolExecutionStarted({ index: 2, toolCallId: 'read', startedAt: 3 })
    databases.splice(databases.indexOf(database), 1)
    database.close()
    const reopened = new SessionDatabase({ getUserDataPath: () => directory })
    databases.push(reopened)
    await reopened.initialize()
    const restored = new SessionRuntimeService({ database: reopened })
    restored.recoverInterruptedRuns()
    expect(restored.loadSession(session.id).messages.at(-1)).toMatchObject({
      role: 'assistant',
      metadata: { completionState: 'stopped' },
      parts: [expect.objectContaining({ type: 'tool-trace', toolCallId: 'read' })]
    })
    expect(restored.loadSession(session.id).recovery).toMatchObject({
      status: 'interrupted',
      canRetry: false,
      blockedReason: expect.any(String)
    })
    expect(() => restored.getRetryProfile(session.id, run.runId)).toThrow(/unknown/i)
  })
})
