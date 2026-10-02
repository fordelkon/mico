import { realpath } from 'node:fs/promises'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createBashTool } from './bash-tool'
import { createTemporaryWorkspace, removeTemporaryPaths } from './test-helpers'

describe('bash tool', () => {
  // Windows taskkill is asynchronous. Retry the workspace removal until its
  // descendant process has released the cwd rather than racing cleanup.
  afterEach(() => removeTemporaryPaths({ maxRetries: 10, retryDelay: 100 }))

  async function createContext() {
    const cwd = await createTemporaryWorkspace('mico-bash-tool-')
    return { cwd, signal: new AbortController().signal }
  }

  async function createStreamingContext() {
    const cwd = await createTemporaryWorkspace('mico-bash-tool-')
    const controller = new AbortController()
    const deltas: Array<{ stream: string; delta: string }> = []
    return {
      cwd,
      signal: controller.signal,
      controller,
      deltas,
      onOutputDelta: (delta: { stream: string; delta: string }) => deltas.push(delta)
    }
  }

  it('user commands run when executed, then they start in the session cwd', async () => {
    const context = await createContext()
    const command = 'node -e "console.log(process.cwd())"'

    const result = await createBashTool().execute({ command }, context)

    expect(result.output.trim()).toBe(await realpath(context.cwd))
  })

  it('user sees output while the command still runs when it writes both streams, then each delta arrives before completion', async () => {
    const context = await createStreamingContext()
    // The command stays alive after writing so settling the promise cannot race
    // the deltas: any delta observed here arrived while the command still ran.
    let settled = false
    const pending = createBashTool()
      .execute(
        {
          command:
            "node -e \"process.stdout.write('out'); process.stderr.write('err'); setTimeout(() => {}, 30000)\""
        },
        context
      )
      .then(
        (result) => {
          settled = true
          return result
        },
        (error) => {
          settled = true
          throw error
        }
      )

    await vi.waitFor(() => {
      expect(context.deltas).toEqual(
        expect.arrayContaining([
          { stream: 'stdout', delta: 'out' },
          { stream: 'stderr', delta: 'err' }
        ])
      )
    })

    expect(settled).toBe(false)
    context.controller.abort()
    await expect(pending).rejects.toThrow('Command aborted')
  })

  it('user watches command progress when output streams, then both streams arrive', async () => {
    const context = await createStreamingContext()
    const command = "node -e \"process.stdout.write('out'); process.stderr.write('err')\""

    const result = await createBashTool().execute({ command }, context)

    expect(context.deltas).toEqual(
      expect.arrayContaining([
        { stream: 'stdout', delta: 'out' },
        { stream: 'stderr', delta: 'err' }
      ])
    )
    expect(result.output).toContain('out')
    expect(result.output).toContain('err')
  })

  it('user sees a failure when a command exits non-zero, then the code is reported', async () => {
    const context = await createContext()
    const command = 'node -e "process.exit(7)"'

    await expect(createBashTool().execute({ command }, context)).rejects.toThrow(
      'Command exited with code 7'
    )
  })

  it('user stops a running command when cancelling, then execution rejects with an abort error', async () => {
    const { cwd } = await createContext()
    const controller = new AbortController()
    const command = 'node -e "process.stdout.write(\'ready\'); setTimeout(() => {}, 30000)"'
    const deltas: Array<{ stream: string; delta: string }> = []

    const pending = createBashTool().execute(
      { command },
      { cwd, signal: controller.signal, onOutputDelta: (delta) => deltas.push(delta) }
    )
    // Abort once the command is observably running. Aborting during shell startup
    // races taskkill's tree enumeration against the shell spawning the command,
    // which can orphan the command instead of killing it.
    await vi.waitFor(() => expect(deltas).toContainEqual({ stream: 'stdout', delta: 'ready' }))
    controller.abort()

    await expect(pending).rejects.toThrow('Command aborted')
  })

  it.each([
    ['ls -la', true],
    ['cat a.md && grep pattern b.md', true],
    ['git status', true],
    ['rm -rf build/', false],
    ['ls; rm x', false],
    ['echo hi > f.txt', false],
    ['git push', false],
    ['ls |', false],
    ['node script.js', false]
  ])(
    'user submits %s when scheduling tools, then parallel execution eligibility is %s',
    (command, safe) => {
      expect(createBashTool().isConcurrencySafe({ command })).toBe(safe)
    }
  )
})
