import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ToolRegistry } from './tool-registry'
import { createTemporaryWorkspace, removeTemporaryPaths } from './test-helpers'

describe('ToolRegistry', () => {
  afterEach(() => removeTemporaryPaths())

  async function createRegistry(): Promise<ToolRegistry> {
    return ToolRegistry.forWorkspace(await createTemporaryWorkspace('mico-tool-registry-'))
  }

  it('user sees an error result when calling an unknown tool, then nothing executes', async () => {
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

  it('user sees an error when tool input fails validation, then the tool never runs', async () => {
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

  it('user sees a tool error when execution fails, then the failure is captured', async () => {
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

  it('user gets ordered runs when exclusive and write tools mix, then none overlap', async () => {
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

  it('user gets results in submission order when a slow read runs with a fast read, then order is preserved', async () => {
    const cwd = await createTemporaryWorkspace('mico-tool-registry-')
    // The first read moves the most bytes, so completion order alone would
    // put it last; batching must keep results aligned with the requests.
    await writeFile(join(cwd, 'big.txt'), 'x'.repeat(200 * 1024))
    await writeFile(join(cwd, 'small.txt'), 'small')
    const registry = ToolRegistry.forWorkspace(cwd)

    const results = await registry.executeBatch(
      [
        { toolCallId: 'call-slow', toolName: 'read', input: { path: 'big.txt' } },
        { toolCallId: 'call-fast', toolName: 'read', input: { path: 'small.txt' } }
      ],
      new AbortController().signal
    )

    expect(results.map((result) => result.toolCallId)).toEqual(['call-slow', 'call-fast'])
    expect(results.map((result) => result.isError)).toEqual([false, false])
  })

  it('user batches a read-only command with a read when both are concurrency-safe, then both results arrive', async () => {
    const cwd = await createTemporaryWorkspace('mico-tool-registry-')
    await writeFile(join(cwd, 'a.txt'), 'content')
    const registry = ToolRegistry.forWorkspace(cwd)

    const results = await registry.executeBatch(
      [
        { toolCallId: 'call-list', toolName: 'bash', input: { command: 'ls -la' } },
        { toolCallId: 'call-read', toolName: 'read', input: { path: 'a.txt' } }
      ],
      new AbortController().signal
    )

    expect(results.map((result) => result.isError)).toEqual([false, false])
  })

  it('user sees live output attributed when a tool streams, then the result is intact', async () => {
    const cwd = await createTemporaryWorkspace('mico-tool-registry-')
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

  it('user gets bounded deltas when a preview is large, then no content is dropped', async () => {
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
