import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { ToolRegistry } from './tool-registry'
import { createTemporaryWorkspace, removeTemporaryPaths } from './test-helpers'

describe('workspace tool protocol', () => {
  afterEach(() => removeTemporaryPaths())

  it('user creates and edits a file when using Claude Code arguments, then replacements preserve surrounding content', async () => {
    const cwd = await createTemporaryWorkspace('mico-protocol-')
    const registry = ToolRegistry.forWorkspace(cwd)
    const signal = new AbortController().signal
    const file_path = join(cwd, 'file.txt')
    const results = await registry.executeBatch(
      [
        {
          toolCallId: 'write',
          toolName: 'Write',
          input: { file_path, content: 'before before suffix' }
        },
        {
          toolCallId: 'edit',
          toolName: 'Edit',
          input: { file_path, old_string: 'before', new_string: 'after', replace_all: true }
        },
        { toolCallId: 'read', toolName: 'Read', input: { file_path } }
      ],
      signal
    )
    expect(results.map(({ isError }) => isError)).toEqual([false, false, false])
    expect(results[2].output).toContain('after after suffix')
    expect(await readFile(file_path, 'utf8')).toBe('after after suffix')
    expect(registry.definitions.map(({ name }) => name).sort()).toEqual([
      'Bash',
      'Edit',
      'Glob',
      'Grep',
      'Read',
      'Write'
    ])
    expect(registry.definitions.find(({ name }) => name === 'Edit')?.inputSchema).toMatchObject({
      type: 'object',
      required: ['file_path', 'old_string', 'new_string'],
      additionalProperties: false
    })
    expect(registry.definitions.find(({ name }) => name === 'Write')?.inputSchema).toMatchObject({
      type: 'object',
      required: ['file_path', 'content'],
      additionalProperties: false
    })
  })

  it('user receives invalid edit arguments when a call is empty, then field errors explain how to retry without writing', async () => {
    const cwd = await createTemporaryWorkspace('mico-protocol-')
    const file_path = join(cwd, 'file.txt')
    await writeFile(file_path, 'unchanged')
    const result = await ToolRegistry.forWorkspace(cwd).execute(
      { toolCallId: 'empty', toolName: 'Edit', input: {} },
      new AbortController().signal
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain('file_path')
    expect(result.output).toContain('old_string')
    expect(result.output).toContain('new_string')
    expect(await readFile(file_path, 'utf8')).toBe('unchanged')
  })
})
