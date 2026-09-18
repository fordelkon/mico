import { mkdtemp, rm } from 'node:fs/promises'
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
})
