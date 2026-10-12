import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ToolRegistry } from './registry'
import { createTemporaryWorkspace, removeTemporaryPaths } from './test-helpers'

describe('ToolRegistry', () => {
  afterEach(async () => {
    vi.useRealTimers()
    await removeTemporaryPaths()
  })

  it('user writes then reads when tools run in sequence, then each trace records its own interval', async () => {
    const cwd = await createTemporaryWorkspace('mico-tool-registry-')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1000)
    let clock = 1000
    const advanceClock = async (): Promise<void> => {
      clock += 100
      vi.setSystemTime(clock)
    }
    const registry = ToolRegistry.forWorkspace(cwd, {
      permissionMode: 'acceptEdits',
      hooks: { preToolUse: [advanceClock], postToolUse: [advanceClock] }
    })
    const executions = await registry.executeBatch(
      [
        {
          toolCallId: 'write',
          toolName: 'Write',
          input: { file_path: 'timed.txt', content: 'Recorded' }
        },
        { toolCallId: 'read', toolName: 'Read', input: { file_path: 'timed.txt' } }
      ],
      new AbortController().signal
    )
    expect(
      executions.map(({ trace }) => ({
        id: trace.toolCallId,
        start: trace.startedAt,
        end: trace.finishedAt
      }))
    ).toEqual([
      { id: 'write', start: 1000, end: 1100 },
      { id: 'read', start: 1200, end: 1300 }
    ])
    expect(executions[1].trace).toMatchObject({
      toolName: 'Read',
      input: { file_path: 'timed.txt' },
      output: 'Recorded',
      isError: false
    })
    expect(executions[1].result.output).toBe('Recorded')
  })

  async function createRegistry(): Promise<ToolRegistry> {
    return ToolRegistry.forWorkspace(await createTemporaryWorkspace('mico-tool-registry-'), {
      requestApproval: async () => true
    })
  }

  it('user sees an error result when calling an unknown tool, then nothing executes', async () => {
    const { result } = await (await createRegistry()).execute(
      { toolCallId: 'call-1', toolName: 'unknown', input: {} },
      new AbortController().signal
    )

    expect(result).toEqual({
      type: 'tool-result',
      toolCallId: 'call-1',
      toolName: 'unknown',
      output: 'Tool "unknown" is unavailable.',
      isError: true
    })
  })

  it('user sees an error when tool input fails validation, then the tool never runs', async () => {
    const { result } = await (await createRegistry()).execute(
      { toolCallId: 'call-2', toolName: 'Read', input: { file_path: 1 } },
      new AbortController().signal
    )

    expect(result).toMatchObject({
      type: 'tool-result',
      toolCallId: 'call-2',
      toolName: 'Read',
      isError: true
    })
    expect(result.output).toContain('Invalid tool input.')
  })

  it('user sees a tool error when execution fails, then the failure is captured', async () => {
    const registry = await createRegistry()

    const { result } = await registry.execute(
      { toolCallId: 'call-3', toolName: 'Read', input: { file_path: 'missing.txt' } },
      new AbortController().signal
    )

    expect(result).toMatchObject({
      type: 'tool-result',
      toolCallId: 'call-3',
      toolName: 'Read',
      isError: true
    })
    expect(result.output).toContain('ENOENT')
  })

  it('user writes after a command when tools are submitted in order, then the command sees no new file', async () => {
    const registry = await createRegistry()
    const results = (
      await registry.executeBatch(
        [
          {
            toolCallId: 'call-command',
            toolName: 'Bash',
            input: {
              command:
                "node -e \"const fs=require('node:fs'); if (fs.existsSync('created.txt')) process.exit(1)\""
            }
          },
          {
            toolCallId: 'call-write',
            toolName: 'Write',
            input: { file_path: 'created.txt', content: 'created after command' }
          }
        ],
        new AbortController().signal
      )
    ).map(({ result }) => result)

    expect(results.map((result) => result.isError)).toEqual([false, false])
  })

  it('user reads files of different sizes when submitting a batch, then results retain submission order', async () => {
    const cwd = await createTemporaryWorkspace('mico-tool-registry-')
    await writeFile(join(cwd, 'big.txt'), 'x'.repeat(200 * 1024))
    await writeFile(join(cwd, 'small.txt'), 'small')
    const registry = ToolRegistry.forWorkspace(cwd)

    const results = (
      await registry.executeBatch(
        [
          { toolCallId: 'call-slow', toolName: 'Read', input: { file_path: 'big.txt' } },
          { toolCallId: 'call-fast', toolName: 'Read', input: { file_path: 'small.txt' } }
        ],
        new AbortController().signal
      )
    ).map(({ result }) => result)

    expect(results.map((result) => result.toolCallId)).toEqual(['call-slow', 'call-fast'])
    expect(results.map((result) => result.isError)).toEqual([false, false])
  })

  it('user submits a command with a file read when batching tools, then both succeed', async () => {
    const cwd = await createTemporaryWorkspace('mico-tool-registry-')
    await writeFile(join(cwd, 'a.txt'), 'content')
    const registry = ToolRegistry.forWorkspace(cwd, { requestApproval: async () => true })

    const results = (
      await registry.executeBatch(
        [
          { toolCallId: 'call-list', toolName: 'Bash', input: { command: 'ls -la' } },
          { toolCallId: 'call-read', toolName: 'Read', input: { file_path: 'a.txt' } }
        ],
        new AbortController().signal
      )
    ).map(({ result }) => result)

    expect(results.map((result) => result.isError)).toEqual([false, false])
  })

  it('user sees live output attributed when a tool streams, then the result is intact', async () => {
    const cwd = await createTemporaryWorkspace('mico-tool-registry-')
    await writeFile(join(cwd, 'preview.txt'), 'preview text')
    const deltas: unknown[] = []
    const { result } = await ToolRegistry.forWorkspace(cwd).execute(
      { toolCallId: 'call-preview', toolName: 'Read', input: { file_path: 'preview.txt' } },
      new AbortController().signal,
      (delta) => deltas.push(delta)
    )

    expect(deltas).toEqual([
      {
        toolCallId: 'call-preview',
        toolName: 'Read',
        stream: 'preview',
        delta: 'preview text'
      }
    ])
    expect(result).toMatchObject({ isError: false, output: 'preview text' })
  })

  it('user gets bounded deltas when a preview is large, then no content is dropped', async () => {
    const registry = await createRegistry()
    const content = 'x'.repeat(20 * 1024)
    const deltas: string[] = []

    await registry.execute(
      {
        toolCallId: 'call-large-preview',
        toolName: 'Write',
        input: { file_path: 'large.txt', content }
      },
      new AbortController().signal,
      (delta) => deltas.push(delta.delta)
    )

    expect(deltas).toHaveLength(2)
    expect(deltas.join('')).toBe(content)
    expect(deltas.every((delta) => delta.length <= 16 * 1024)).toBe(true)
  })
})
