import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createEditTool } from './edit-tool'
import { createReadTool } from './read-tool'
import { ToolRegistry } from './tool-registry'
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
    const context = await createStreamingContext()
    await writeFile(join(context.cwd, 'a.txt'), 'one\ntwo\nthree\n')

    const result = await createReadTool().execute(
      { file_path: 'a.txt', offset: 2, limit: 1 },
      context
    )

    expect(result.output).toBe('two\n\n[More content available. Use offset=3.]')
    expect(context.deltas).toEqual([
      { stream: 'preview', delta: 'two\n\n[More content available. Use offset=3.]' }
    ])
  })

  it('user gets an error when an edit is ambiguous, then the file is unchanged', async () => {
    const context = await createContext()
    await writeFile(join(context.cwd, 'a.txt'), 'same\nsame\n')

    await expect(
      createEditTool().execute(
        { file_path: 'a.txt', old_string: 'same', new_string: 'new' },
        context
      )
    ).rejects.toThrow('must match exactly once')
    await expect(readFile(join(context.cwd, 'a.txt'), 'utf8')).resolves.toBe('same\nsame\n')
  })

  it('user gets a recovery hint when an edit changes nothing, then the tool refuses before writing', async () => {
    const cwd = await createTemporaryWorkspace('mico-file-tool-')
    await writeFile(join(cwd, 'a.txt'), 'unchanged\n')
    const registry = ToolRegistry.forWorkspace(cwd)

    const { result } = await registry.execute(
      {
        toolCallId: 'call-noop',
        toolName: 'Edit',
        input: { file_path: 'a.txt', old_string: 'unchanged', new_string: 'unchanged' }
      },
      new AbortController().signal
    )

    expect(result).toMatchObject({ isError: true })
    expect(result.output).toContain('Re-read the file and provide an actual change.')
    await expect(readFile(join(cwd, 'a.txt'), 'utf8')).resolves.toBe('unchanged\n')
  })

  it('user edits overlapping matches when replace_all is omitted, then the file stays unchanged', async () => {
    const context = await createContext()
    await writeFile(join(context.cwd, 'a.txt'), 'aaa')
    await expect(
      createEditTool().execute(
        {
          file_path: 'a.txt',
          old_string: 'aa',
          new_string: 'b'
        },
        context
      )
    ).rejects.toThrow('must match exactly once')
    await expect(readFile(join(context.cwd, 'a.txt'), 'utf8')).resolves.toBe('aaa')
  })

  it('user creates a nested file when writing a new path, then a rewrite replaces it', async () => {
    const context = await createStreamingContext()

    await expect(
      createWriteTool().execute({ file_path: 'nested/a.txt', content: 'ok' }, context)
    ).resolves.toEqual({
      output: 'Created nested/a.txt.'
    })

    await expect(readFile(join(context.cwd, 'nested/a.txt'), 'utf8')).resolves.toBe('ok')
    await expect(
      createWriteTool().execute({ file_path: 'nested/a.txt', content: 'updated' }, context)
    ).resolves.toEqual({
      output: 'Replaced nested/a.txt.'
    })
    await expect(readFile(join(context.cwd, 'nested/a.txt'), 'utf8')).resolves.toBe('updated')
    expect(context.deltas).toEqual([
      { stream: 'preview', delta: 'ok' },
      { stream: 'preview', delta: 'updated' }
    ])
  })

  it('user sees what changed when an edit runs, then a diff-style preview is emitted', async () => {
    const context = await createStreamingContext()
    await writeFile(join(context.cwd, 'a.txt'), 'before\n')

    await createEditTool().execute(
      { file_path: 'a.txt', old_string: 'before', new_string: 'after\nnext' },
      context
    )

    expect(context.deltas).toEqual([{ stream: 'preview', delta: '- before\n+ after\n+ next' }])
    await expect(readFile(join(context.cwd, 'a.txt'), 'utf8')).resolves.toBe('after\nnext\n')
  })
})
