import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createEditTool } from './edit-tool'
import { createReadTool } from './read-tool'
import { createWriteTool } from './write-tool'

describe('workspace file tools', () => {
  const temporaryPaths: string[] = []

  afterEach(async () => {
    await Promise.all(
      temporaryPaths.splice(0).map((path) => rm(path, { force: true, recursive: true }))
    )
  })

  async function createContext() {
    const cwd = await mkdtemp(join(tmpdir(), 'mico-file-tool-'))
    temporaryPaths.push(cwd)
    return { cwd, signal: new AbortController().signal }
  }

  it('returns a line-bounded read result with a continuation offset', async () => {
    const context = await createContext()
    await writeFile(join(context.cwd, 'a.txt'), 'one\ntwo\nthree\n')

    const result = await createReadTool().execute({ path: 'a.txt', offset: 2, limit: 1 }, context)

    expect(result.output).toBe('two\n\n[More content available. Use offset=3.]')
  })

  it('rejects an edit when oldText matches more than one location', async () => {
    const context = await createContext()
    await writeFile(join(context.cwd, 'a.txt'), 'same\nsame\n')

    await expect(
      createEditTool().execute(
        { path: 'a.txt', edits: [{ oldText: 'same', newText: 'new' }] },
        context
      )
    ).rejects.toThrow('must match exactly once')
  })

  it('creates a nested file inside the workspace', async () => {
    const context = await createContext()

    await createWriteTool().execute({ path: 'nested/a.txt', content: 'ok' }, context)

    await expect(readFile(join(context.cwd, 'nested/a.txt'), 'utf8')).resolves.toBe('ok')
  })
})
