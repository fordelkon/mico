import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createEditTool } from './edit-tool'
import { createReadTool } from './read-tool'
import { createWriteTool } from './write-tool'
import { createTemporaryWorkspace, removeTemporaryPaths } from './test-helpers'

describe('workspace file tools', () => {
  afterEach(() => removeTemporaryPaths())

  async function createContext() {
    const cwd = await createTemporaryWorkspace('mico-file-tool-')
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

  it('user reads a window when offset and limit are set, then it offers a continuation', async () => {
    const context = await createContext()
    await writeFile(join(context.cwd, 'a.txt'), 'one\ntwo\nthree\n')

    const result = await createReadTool().execute({ path: 'a.txt', offset: 2, limit: 1 }, context)

    expect(result.output).toBe('two\n\n[More content available. Use offset=3.]')
  })

  it('user sees a preview when a read is bounded, then only the selection is emitted', async () => {
    const context = await createStreamingContext()
    await writeFile(join(context.cwd, 'a.txt'), 'one\ntwo\nthree\n')

    await createReadTool().execute({ path: 'a.txt', limit: 2 }, context)

    expect(context.deltas).toEqual([
      { stream: 'preview', delta: 'one\ntwo\n\n[More content available. Use offset=3.]' }
    ])
  })

  it('user gets an error when an edit is ambiguous, then the file is unchanged', async () => {
    const context = await createContext()
    await writeFile(join(context.cwd, 'a.txt'), 'same\nsame\n')

    await expect(
      createEditTool().execute(
        { path: 'a.txt', edits: [{ oldText: 'same', newText: 'new' }] },
        context
      )
    ).rejects.toThrow('must match exactly once')
  })

  it('user creates a nested file when writing a new path, then a rewrite replaces it', async () => {
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

  it('user sees the content preview when a write starts, then the write succeeds', async () => {
    const context = await createStreamingContext()

    await createWriteTool().execute({ path: 'nested/a.txt', content: 'const value = 1\n' }, context)

    expect(context.deltas).toEqual([{ stream: 'preview', delta: 'const value = 1\n' }])
  })

  it('user sees what changed when an edit runs, then a diff-style preview is emitted', async () => {
    const context = await createStreamingContext()
    await writeFile(join(context.cwd, 'a.txt'), 'before\n')

    await createEditTool().execute(
      { path: 'a.txt', edits: [{ oldText: 'before', newText: 'after\nnext' }] },
      context
    )

    expect(context.deltas).toEqual([{ stream: 'preview', delta: '- before\n+ after\n+ next' }])
  })
})
