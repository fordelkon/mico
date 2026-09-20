import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createBashTool } from './bash-tool'

describe('bash tool', () => {
  const temporaryPaths: string[] = []

  afterEach(async () => {
    await Promise.all(
      temporaryPaths
        .splice(0)
        // Windows taskkill is asynchronous. Retry the workspace removal until its
        // descendant process has released the cwd rather than racing cleanup.
        .map((path) => rm(path, { force: true, maxRetries: 5, recursive: true, retryDelay: 50 }))
    )
  })

  async function createContext() {
    const cwd = await mkdtemp(join(tmpdir(), 'mico-bash-tool-'))
    temporaryPaths.push(cwd)
    return { cwd, signal: new AbortController().signal }
  }

  it('starts commands in the session cwd', async () => {
    const context = await createContext()
    const command = 'node -e "console.log(process.cwd())"'

    const result = await createBashTool().execute({ command }, context)

    expect(result.output.trim()).toBe(await realpath(context.cwd))
  })

  it('reports stdout fragments before the command settles', async () => {
    const context = await createContext()
    const deltas: Array<{ stream: string; delta: string }> = []

    const result = await createBashTool().execute(
      { command: "node -e \"process.stdout.write('out'); process.stderr.write('err')\"" },
      { ...context, onOutputDelta: (delta) => deltas.push(delta) }
    )

    expect(deltas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stream: 'stdout', delta: 'out' }),
        expect.objectContaining({ stream: 'stderr', delta: 'err' })
      ])
    )
    expect(result.output).toContain('out')
    expect(result.output).toContain('err')
  })

  it('emits stdout and stderr fragments while a command runs', async () => {
    const context = await createContext()
    const deltas: Array<{ stream: string; delta: string }> = []
    const command = "node -e \"process.stdout.write('out'); process.stderr.write('err')\""

    const result = await createBashTool().execute(
      { command },
      {
        ...context,
        onOutputDelta: (delta) => deltas.push(delta)
      }
    )

    expect(deltas).toEqual(
      expect.arrayContaining([
        { stream: 'stdout', delta: 'out' },
        { stream: 'stderr', delta: 'err' }
      ])
    )
    expect(result.output).toContain('out')
    expect(result.output).toContain('err')
  })

  it('reports a non-zero exit as a tool failure', async () => {
    const context = await createContext()
    const command = 'node -e "process.exit(7)"'

    await expect(createBashTool().execute({ command }, context)).rejects.toThrow(
      'Command exited with code 7'
    )
  })

  it('terminates the child process when aborted', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'mico-bash-tool-'))
    temporaryPaths.push(cwd)
    const controller = new AbortController()
    const command = 'node -e "setTimeout(() => {}, 30000)"'

    const pending = createBashTool().execute({ command }, { cwd, signal: controller.signal })
    controller.abort()

    await expect(pending).rejects.toThrow('Command aborted')
  })
})
