import { realpath } from 'node:fs/promises'

import { afterEach, describe, expect, it } from 'vitest'

import { createBashTool } from './bash-tool'
import { createTemporaryWorkspace, removeTemporaryPaths } from './test-helpers'

describe('bash tool', () => {
  const commandCleanups: Array<() => Promise<void>> = []
  afterEach(async () => {
    await Promise.all(commandCleanups.splice(0).map((cleanup) => cleanup()))
    await removeTemporaryPaths()
  })

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
      onOutputDelta: (delta: { stream: string; delta: string }) => {
        deltas.push(delta)
      }
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
    const observed = Promise.withResolvers<void>()
    const collect = context.onOutputDelta
    context.onOutputDelta = (delta) => {
      collect(delta)
      if (
        context.deltas.some((part) => part.stream === 'stdout' && part.delta === 'out') &&
        context.deltas.some((part) => part.stream === 'stderr' && part.delta === 'err')
      )
        observed.resolve()
    }
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

    const drained = pending.catch(() => undefined)
    const cleanup = async () => {
      context.controller.abort()
      await drained
    }
    commandCleanups.push(cleanup)
    try {
      await Promise.race([observed.promise, pending])
      expect(context.deltas).toEqual(
        expect.arrayContaining([
          { stream: 'stdout', delta: 'out' },
          { stream: 'stderr', delta: 'err' }
        ])
      )
      expect(settled).toBe(false)
      context.controller.abort()
      await expect(pending).rejects.toThrow('Command aborted')
    } finally {
      await cleanup()
    }
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
    const command =
      'node -e "process.stdout.write(JSON.stringify({ ready: true, pid: process.pid })); setTimeout(() => {}, 30000)"'
    let output = ''
    const ready = Promise.withResolvers<void>()
    const pending = createBashTool().execute(
      { command },
      {
        cwd,
        signal: controller.signal,
        onOutputDelta: (delta) => {
          if (delta.stream !== 'stdout') return
          output += delta.delta
          if (output.endsWith('}')) ready.resolve()
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
      await Promise.race([ready.promise, pending])
      const commandProcess: { ready: boolean; pid: number } = JSON.parse(output)
      expect(commandProcess.ready).toBe(true)
      controller.abort()
      await expect(pending).rejects.toThrow('Command aborted')
      await removeTemporaryPaths()
      expect(() => process.kill(commandProcess.pid, 0)).toThrow(/ESRCH/)
    } finally {
      await cleanup()
    }
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
