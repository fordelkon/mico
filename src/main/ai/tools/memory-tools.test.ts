import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import type { JsonObject } from '@mico/ai-providers'
import * as z from 'zod'

import type { PermissionMode } from '@shared/ai/permissions'

import { Memories, type MemoryContext, type MemoryRememberInput } from '../memory'
import { createWorkspaceTools, type ToolApprovalRequest, type ToolExecution } from './index'

const preference = {
  scope: 'user',
  key: 'answer-language',
  category: 'user',
  summary: 'Answer in Chinese.',
  content: 'The user prefers answers in Chinese.'
} satisfies MemoryRememberInput
const permissionModes: PermissionMode[] = ['default', 'acceptEdits']

function outputOf(execution: ToolExecution): JsonObject {
  return z.record(z.string(), z.json()).parse(JSON.parse(execution.result.output))
}

describe('Memory tools', () => {
  const directories: string[] = []

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
    )
  })

  async function createMemory(): Promise<{
    owner: Memories
    directory: string
    memory: MemoryContext
  }> {
    const directory = await mkdtemp(join(tmpdir(), 'mico-memory-tools-'))
    directories.push(directory)
    const owner = new Memories({ directory })
    return { owner, directory, memory: owner.openContext({ projectId: 'project-a' }) }
  }

  it('user approves memory tools when saving and revising a preference, then forgetting removes the committed record', async () => {
    const { memory, directory } = await createMemory()
    const approvals: ToolApprovalRequest[] = []
    const tools = createWorkspaceTools(null, {
      memory,
      requestApproval: async (request) => {
        approvals.push(request)
        return true
      }
    })
    const results = await tools.executeBatch(
      [
        { toolCallId: 'create', toolName: 'RememberMemory', input: preference },
        { toolCallId: 'find-created', toolName: 'SearchMemory', input: { query: 'Chinese' } },
        {
          toolCallId: 'update',
          toolName: 'RememberMemory',
          input: { ...preference, summary: 'Answer briefly in Chinese.', expectedRevision: 1 }
        },
        { toolCallId: 'find-updated', toolName: 'SearchMemory', input: { query: 'Chinese' } },
        {
          toolCallId: 'forget',
          toolName: 'ForgetMemory',
          input: { scope: 'user', key: preference.key, expectedRevision: 2 }
        },
        { toolCallId: 'find-deleted', toolName: 'SearchMemory', input: { query: 'Chinese' } }
      ],
      new AbortController().signal
    )

    expect(results.map(({ result }) => result.isError)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false
    ])
    expect(outputOf(results[0])).toEqual({
      scope: 'user',
      key: preference.key,
      revision: 1,
      deleted: false
    })
    expect(outputOf(results[1])).toMatchObject({
      records: [{ scope: 'user', key: preference.key, revision: 1, content: preference.content }]
    })
    expect(outputOf(results[2])).toEqual({
      scope: 'user',
      key: preference.key,
      revision: 2,
      deleted: false
    })
    expect(outputOf(results[3])).toMatchObject({
      records: [{ summary: 'Answer briefly in Chinese.', revision: 2 }]
    })
    expect(outputOf(results[4])).toEqual({
      scope: 'user',
      key: preference.key,
      revision: 3,
      deleted: true
    })
    expect(outputOf(results[5])).toEqual({ records: [], truncated: false })
    expect(approvals.map(({ toolName }) => toolName)).toEqual([
      'RememberMemory',
      'RememberMemory',
      'ForgetMemory'
    ])
    expect(approvals.every(({ reason }) => reason.includes('persistent user memory'))).toBe(true)
    const reopened = new Memories({ directory }).openContext({})
    expect(await reopened.preferences()).toBe('')
    await expect(reopened.remember(preference)).rejects.toThrow('current revision 3')
  })

  it.each(permissionModes)(
    'user denies a memory change when mode is %s, then neither saving nor deletion changes storage',
    async (permissionMode) => {
      const { memory, directory } = await createMemory()
      await memory.remember(preference)
      const approvals: ToolApprovalRequest[] = []
      const tools = createWorkspaceTools(null, {
        memory,
        permissionMode,
        requestApproval: async (request) => {
          approvals.push(request)
          return false
        }
      })
      const results = await tools.executeBatch(
        [
          {
            toolCallId: 'deny-update',
            toolName: 'RememberMemory',
            input: { ...preference, content: 'Rejected change.', expectedRevision: 1 }
          },
          {
            toolCallId: 'deny-create',
            toolName: 'RememberMemory',
            input: { ...preference, key: 'rejected-key' }
          },
          {
            toolCallId: 'deny-forget',
            toolName: 'ForgetMemory',
            input: { scope: 'user', key: preference.key, expectedRevision: 1 }
          }
        ],
        new AbortController().signal
      )

      expect(results.map(({ result }) => result.isError)).toEqual([true, true, true])
      expect(
        results.every(({ result }) => result.output.includes('Permission denied by the user'))
      ).toBe(true)
      expect(approvals).toHaveLength(3)
      const reopened = new Memories({ directory }).openContext({})
      expect((await reopened.search({ query: 'Chinese' })).records).toMatchObject([
        { key: preference.key, content: preference.content, revision: 1 }
      ])
      expect((await reopened.search({ query: 'rejected-key' })).records).toEqual([])
    }
  )

  it('user requests another project through memory tools when scope is bound, then foreign records remain inaccessible', async () => {
    const { owner, memory } = await createMemory()
    await memory.remember({
      ...preference,
      scope: 'project',
      key: 'private-detail',
      content: 'Project A confidential detail.'
    })
    const other = owner.openContext({ projectId: 'project-b' })
    const tools = createWorkspaceTools(null, { memory: other, requestApproval: async () => true })
    const results = await tools.executeBatch(
      [
        {
          toolCallId: 'search-bound',
          toolName: 'SearchMemory',
          input: { query: 'confidential', scope: 'project' }
        },
        {
          toolCallId: 'forge-project',
          toolName: 'SearchMemory',
          input: { query: 'confidential', scope: 'project', projectId: 'project-a' }
        },
        {
          toolCallId: 'forge-path',
          toolName: 'RememberMemory',
          input: { ...preference, scope: 'project', path: '../project-a.json' }
        },
        {
          toolCallId: 'foreign-delete',
          toolName: 'ForgetMemory',
          input: { scope: 'project', key: 'private-detail', expectedRevision: 1 }
        }
      ],
      new AbortController().signal
    )

    expect(outputOf(results[0])).toEqual({ records: [], truncated: false })
    expect(results[1].result).toMatchObject({
      isError: true,
      output: expect.stringContaining('Invalid tool input')
    })
    expect(results[2].result).toMatchObject({
      isError: true,
      output: expect.stringContaining('Invalid tool input')
    })
    expect(results[3].result).toMatchObject({
      isError: true,
      output: expect.stringContaining('current revision 0')
    })
    expect(
      (await memory.search({ query: 'confidential', scope: 'project' })).records
    ).toMatchObject([
      { key: 'private-detail', content: 'Project A confidential detail.', revision: 1 }
    ])
    expect((await other.search({ query: 'Chinese' })).records).toEqual([])

    const unbound = createWorkspaceTools(null, {
      memory: owner.openContext({}),
      requestApproval: async () => true
    })
    const unavailable = await unbound.execute(
      {
        toolCallId: 'unbound-project',
        toolName: 'RememberMemory',
        input: { ...preference, scope: 'project' }
      },
      new AbortController().signal
    )
    expect(unavailable.result).toMatchObject({
      isError: true,
      output: expect.stringContaining('Project memory is unavailable')
    })
  })
})
