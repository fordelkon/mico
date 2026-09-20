import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ToolRegistry } from './tool-registry'

describe('ToolRegistry', () => {
  const temporaryPaths: string[] = []

  afterEach(async () => {
    await Promise.all(
      temporaryPaths.splice(0).map((path) => rm(path, { force: true, recursive: true }))
    )
  })

  async function createRegistry(): Promise<ToolRegistry> {
    const cwd = await mkdtemp(join(tmpdir(), 'mico-tool-registry-'))
    temporaryPaths.push(cwd)
    return ToolRegistry.forWorkspace(cwd)
  }

  it('returns an error result for a tool the workspace does not expose', async () => {
    const result = await (await createRegistry()).execute(
      { toolCallId: 'call-1', toolName: 'unknown', input: {} },
      new AbortController().signal
    )

    expect(result).toEqual({
      type: 'tool-result',
      toolCallId: 'call-1',
      toolName: 'unknown',
      output: 'Tool "unknown" is unavailable.',
      isError: true
    })
  })

  it('returns an error result when a tool call fails schema validation', async () => {
    const result = await (await createRegistry()).execute(
      { toolCallId: 'call-2', toolName: 'read', input: { path: 1 } },
      new AbortController().signal
    )

    expect(result).toMatchObject({
      type: 'tool-result',
      toolCallId: 'call-2',
      toolName: 'read',
      isError: true
    })
    expect(result.output).toContain('Invalid tool input.')
  })

  it('returns a tool error result when execution fails', async () => {
    const registry = await createRegistry()

    const result = await registry.execute(
      { toolCallId: 'call-3', toolName: 'read', input: { path: 'missing.txt' } },
      new AbortController().signal
    )

    expect(result).toMatchObject({
      type: 'tool-result',
      toolCallId: 'call-3',
      toolName: 'read',
      isError: true
    })
    expect(result.output).toContain('ENOENT')
  })

  it('does not overlap an exclusive command with a following write', async () => {
    const registry = await createRegistry()
    const results = await registry.executeBatch(
      [
        {
          toolCallId: 'call-command',
          toolName: 'bash',
          input: {
            command:
              "node -e \"const fs=require('node:fs'); if (fs.existsSync('created.txt')) process.exit(1)\""
          }
        },
        {
          toolCallId: 'call-write',
          toolName: 'write',
          input: { path: 'created.txt', content: 'created after command' }
        }
      ],
      new AbortController().signal
    )

    expect(results.map((result) => result.isError)).toEqual([false, false])
  })

  it('associates live tool output with the originating call without changing its final result', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'mico-tool-registry-'))
    temporaryPaths.push(cwd)
    await writeFile(join(cwd, 'preview.txt'), 'preview text')
    const deltas: unknown[] = []
    const result = await ToolRegistry.forWorkspace(cwd).execute(
      { toolCallId: 'call-preview', toolName: 'read', input: { path: 'preview.txt' } },
      new AbortController().signal,
      (delta) => deltas.push(delta)
    )

    expect(deltas).toEqual([
      {
        toolCallId: 'call-preview',
        toolName: 'read',
        stream: 'preview',
        delta: 'preview text'
      }
    ])
    expect(result).toMatchObject({ isError: false, output: 'preview text' })
  })

  it('splits a large preview into bounded deltas without dropping content', async () => {
    const registry = await createRegistry()
    const content = 'x'.repeat(20 * 1024)
    const deltas: string[] = []

    await registry.execute(
      {
        toolCallId: 'call-large-preview',
        toolName: 'write',
        input: { path: 'large.txt', content }
      },
      new AbortController().signal,
      (delta) => deltas.push(delta.delta)
    )

    expect(deltas).toHaveLength(2)
    expect(deltas.join('')).toBe(content)
    expect(deltas.every((delta) => delta.length <= 16 * 1024)).toBe(true)
  })
})
