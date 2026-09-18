import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createBashTool } from './bash-tool'

describe('bash tool', () => {
  const temporaryPaths: string[] = []

  afterEach(async () => {
    await Promise.all(
      temporaryPaths.splice(0).map((path) => rm(path, { force: true, recursive: true }))
    )
  })

  async function createContext() {
    const cwd = await mkdtemp(join(tmpdir(), 'mico-bash-tool-'))
    temporaryPaths.push(cwd)
    return { cwd, signal: new AbortController().signal }
  }

  it('starts commands in the session cwd', async () => {
    const context = await createContext()
    const command = process.platform === 'win32' ? 'cd' : 'pwd'

    const result = await createBashTool().execute({ command }, context)

    expect(result.output.trim()).toBe(await realpath(context.cwd))
  })

  it('reports a non-zero exit as a tool failure', async () => {
    const context = await createContext()
    const command = process.platform === 'win32' ? 'exit /b 7' : 'exit 7'

    await expect(createBashTool().execute({ command }, context)).rejects.toThrow(
      'Command exited with code 7'
    )
  })

  it('terminates the child process when aborted', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'mico-bash-tool-'))
    temporaryPaths.push(cwd)
    const controller = new AbortController()
    const command = process.platform === 'win32' ? 'ping -n 30 127.0.0.1 > nul' : 'sleep 30'

    const pending = createBashTool().execute({ command }, { cwd, signal: controller.signal })
    controller.abort()

    await expect(pending).rejects.toThrow('Command aborted')
  })
})
