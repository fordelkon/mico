import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTemporaryWorkspace, removeTemporaryPaths } from './test-helpers'
import { ToolRegistry } from './tool-registry'

const commandCleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(commandCleanups.splice(0).map((cleanup) => cleanup()))
  await removeTemporaryPaths()
})
describe('Tool execution journal boundary', () => {
  it('user cancels parallel reads when one result arrives, then all started siblings drain', async () => {
    const cwd = await createTemporaryWorkspace('mico-journal-')
    await writeFile(join(cwd, 'a'), 'contents')
    const controller = new AbortController()
    const starts: string[] = []
    const settlements: string[] = []
    const outcome = ToolRegistry.forWorkspace(cwd).executeBatch(
      [
        { toolCallId: 'first', toolName: 'Read', input: { file_path: 'a' } },
        { toolCallId: 'second', toolName: 'Read', input: { file_path: 'a' } }
      ],
      controller.signal,
      undefined,
      {
        onExecutionStarted: (call) => {
          starts.push(call.toolCallId)
        },
        onExecutionSettled: (execution) => {
          settlements.push(execution.result.toolCallId)
          controller.abort()
        }
      }
    )
    await outcome.catch(() => undefined)
    expect([...starts].sort()).toEqual(['first', 'second'])
    expect([...settlements].sort()).toEqual(['first', 'second'])
  })
  it('user interrupts a started command when output arrives, then its outcome remains unknown', async () => {
    const cwd = await createTemporaryWorkspace('mico-journal-')
    const controller = new AbortController()
    const starts: string[] = []
    const settlements: string[] = []
    const registry = ToolRegistry.forWorkspace(cwd, { requestApproval: async () => true })
    const pending = registry.execute(
      {
        toolCallId: 'command',
        toolName: 'Bash',
        input: {
          command: 'node -e "process.stdout.write(\'ready\'); setInterval(() => {}, 1000)"'
        }
      },
      controller.signal,
      () => controller.abort(),
      {
        onExecutionStarted: (call) => {
          starts.push(call.toolCallId)
        },
        onExecutionSettled: (execution) => {
          settlements.push(execution.result.toolCallId)
        }
      }
    )
    const drained = pending.catch(() => undefined)
    const cleanup = async () => {
      controller.abort()
      await drained
    }
    commandCleanups.push(cleanup)
    try {
      await expect(pending).rejects.toThrow(/abort/i)
      expect(starts).toEqual(['command'])
      expect(settlements).toEqual([])
    } finally {
      await cleanup()
    }
  })
  it('user cannot write when durable start fails, then no side effect occurs', async () => {
    const cwd = await createTemporaryWorkspace('mico-journal-')
    const registry = ToolRegistry.forWorkspace(cwd, { permissionMode: 'acceptEdits' })
    await expect(
      registry.execute(
        { toolCallId: 'write', toolName: 'Write', input: { file_path: 'a', content: 'data' } },
        new AbortController().signal,
        undefined,
        {
          onExecutionStarted: () => {
            throw new Error('Storage unavailable')
          }
        }
      )
    ).rejects.toThrow('Storage unavailable')
    expect(existsSync(join(cwd, 'a'))).toBe(false)
  })
  it('user retains a successful write when post hooks fail, then settlement stays successful', async () => {
    const cwd = await createTemporaryWorkspace('mico-journal-')
    const observations: boolean[] = []
    const registry = ToolRegistry.forWorkspace(cwd, {
      permissionMode: 'acceptEdits',
      hooks: {
        postToolUse: [
          async () => {
            throw new Error('Hook failed')
          }
        ]
      }
    })
    const execution = await registry.execute(
      { toolCallId: 'write', toolName: 'Write', input: { file_path: 'a', content: 'data' } },
      new AbortController().signal,
      undefined,
      {
        onExecutionSettled: (execution) => {
          observations.push(execution.result.isError)
        }
      }
    )
    expect(execution.result.isError).toBe(false)
    expect(observations).toEqual([false])
    expect(existsSync(join(cwd, 'a'))).toBe(true)
  })
})
