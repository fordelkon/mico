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

  async function createStreamingContext() {
    const context = await createContext()
    const deltas: Array<{ stream: string; delta: string }> = []
    return {
      ...context,
      deltas,
      onOutputDelta: (delta: { stream: string; delta: string }) => deltas.push(delta)
    }
  }

  it('returns a line-bounded read result with a continuation offset', async () => {
    const context = await createContext()
    await writeFile(join(context.cwd, 'a.txt'), 'one\ntwo\nthree\n')

    const result = await createReadTool().execute({ path: 'a.txt', offset: 2, limit: 1 }, context)

    expect(result.output).toBe('two\n\n[More content available. Use offset=3.]')
  })

  it('emits the selected read content as a preview', async () => {
    const context = await createStreamingContext()
    await writeFile(join(context.cwd, 'a.txt'), 'one\ntwo\nthree\n')

    await createReadTool().execute({ path: 'a.txt', limit: 2 }, context)

    expect(context.deltas).toEqual([
      { stream: 'preview', delta: 'one\ntwo\n\n[More content available. Use offset=3.]' }
    ])
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

    await expect(
      createWriteTool().execute({ path: 'nested/a.txt', content: 'ok' }, context)
    ).resolves.toEqual({
      output: 'Created nested/a.txt.'
    })

    await expect(readFile(join(context.cwd, 'nested/a.txt'), 'utf8')).resolves.toBe('ok')
    await expect(
      createWriteTool().execute({ path: 'nested/a.txt', content: 'updated' }, context)
    ).resolves.toEqual({
      output: 'Replaced nested/a.txt.'
    })
  })

  it('emits write content before reporting a successful write', async () => {
    const context = await createStreamingContext()

    await createWriteTool().execute({ path: 'nested/a.txt', content: 'const value = 1\n' }, context)

    expect(context.deltas).toEqual([{ stream: 'preview', delta: 'const value = 1\n' }])
  })

  it('emits a diff-style preview for a validated edit', async () => {
    const context = await createStreamingContext()
    await writeFile(join(context.cwd, 'a.txt'), 'before\n')

    await createEditTool().execute(
      { path: 'a.txt', edits: [{ oldText: 'before', newText: 'after\nnext' }] },
      context
    )

    expect(context.deltas).toEqual([{ stream: 'preview', delta: '- before\n+ after\n+ next' }])
  })
})
