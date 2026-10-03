import { access, mkdir, readFile, symlink, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ToolRegistry } from './tool-registry'
import { defineAgentTool, registerTool, type ToolOperation } from './tool-contract'
import { authorizeTool } from './tool-permissions'
import { createWriteTool } from './write-tool'
import { createTemporaryWorkspace, removeTemporaryPaths } from './test-helpers'

const writeCall = {
  toolCallId: 'write-1',
  toolName: 'Write',
  input: { file_path: 'created.txt', content: 'approved content' }
}

describe('tool permissions', () => {
  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    await removeTemporaryPaths()
  })

  it('user has no approval host when writing, then the workspace stays unchanged', async () => {
    const cwd = await createTemporaryWorkspace('mico-permissions-')
    const result = await ToolRegistry.forWorkspace(cwd).execute(
      writeCall,
      new AbortController().signal
    )
    expect(result.isError).toBe(true)
    await expect(access(join(cwd, 'created.txt'))).rejects.toThrow('ENOENT')
  })

  it('user approves a pending write when prompted, then only the approved content is written', async () => {
    const cwd = await createTemporaryWorkspace('mico-permissions-')
    const pending = Promise.withResolvers<boolean>()
    const requested = Promise.withResolvers<void>()
    const registry = ToolRegistry.forWorkspace(cwd, {
      requestApproval: async () => {
        requested.resolve()
        return pending.promise
      }
    })
    const execution = registry.execute(writeCall, new AbortController().signal)
    await requested.promise
    await expect(access(join(cwd, 'created.txt'))).rejects.toThrow('ENOENT')
    pending.resolve(true)
    expect((await execution).isError).toBe(false)
    expect(await readFile(join(cwd, 'created.txt'), 'utf8')).toBe('approved content')
  })

  it('user accepts edits when writing ordinary files, then the file is created without prompting', async () => {
    const cwd = await createTemporaryWorkspace('mico-permissions-')
    const result = await ToolRegistry.forWorkspace(cwd, { permissionMode: 'acceptEdits' }).execute(
      writeCall,
      new AbortController().signal
    )
    expect(result.isError).toBe(false)
    expect(await readFile(join(cwd, 'created.txt'), 'utf8')).toBe('approved content')
  })

  it('user accepts edits when a file tool is renamed, then its write still succeeds', async () => {
    const cwd = await createTemporaryWorkspace('mico-permissions-')
    const signal = new AbortController().signal
    const call = { ...writeCall, toolName: 'Save' }
    const tool = registerTool({ ...createWriteTool(), name: call.toolName })
    const prepared = await tool.prepare(call.input, { cwd, signal })

    await authorizeTool(call, cwd, signal, prepared.operation, { permissionMode: 'acceptEdits' })
    await prepared.execute()

    expect(await readFile(join(cwd, 'created.txt'), 'utf8')).toBe('approved content')
  })

  it.each([
    undefined,
    (): ToolOperation => {
      throw new Error('Unknown operation')
    }
  ])(
    'user accepts edits when tool effects are unclassified, then approval is required',
    async (operation) => {
      const cwd = await createTemporaryWorkspace('mico-permissions-')
      const signal = new AbortController().signal
      const write = createWriteTool()
      const definition = {
        name: write.name,
        description: write.description,
        inputSchema: write.inputSchema,
        execute: write.execute
      }
      const tool = registerTool(
        defineAgentTool(operation ? { ...definition, operation } : definition)
      )
      const prepared = await tool.prepare(writeCall.input, { cwd, signal })

      await expect(
        authorizeTool(writeCall, cwd, signal, prepared.operation, {
          permissionMode: 'acceptEdits'
        })
      ).rejects.toThrow('No approval interface is available')
      await expect(access(join(cwd, 'created.txt'))).rejects.toThrow('ENOENT')
    }
  )

  it('user edits through a protected symlink when accepting edits, then approval is still required', async () => {
    const cwd = await createTemporaryWorkspace('mico-permissions-')
    await mkdir(join(cwd, '.git'))
    await writeFile(join(cwd, '.git', 'config'), 'original')
    await symlink(join(cwd, '.git', 'config'), join(cwd, 'alias.txt'))
    const result = await ToolRegistry.forWorkspace(cwd, { permissionMode: 'acceptEdits' }).execute(
      { ...writeCall, input: { file_path: 'alias.txt', content: 'changed' } },
      new AbortController().signal
    )
    expect(result.isError).toBe(true)
    expect(await readFile(join(cwd, '.git', 'config'), 'utf8')).toBe('original')
  })

  it('user creates through a dangling protected symlink when accepting edits, then approval is required', async () => {
    const cwd = await createTemporaryWorkspace('mico-permissions-')
    await mkdir(join(cwd, '.git'))
    await symlink(join(cwd, '.git', 'new-config'), join(cwd, 'alias.txt'))
    const result = await ToolRegistry.forWorkspace(cwd, { permissionMode: 'acceptEdits' }).execute(
      { ...writeCall, input: { file_path: 'alias.txt', content: 'changed' } },
      new AbortController().signal
    )
    expect(result.isError).toBe(true)
    await expect(access(join(cwd, '.git', 'new-config'))).rejects.toThrow('ENOENT')
  })

  it('user receives an empty hook confirmation reason when accepting edits, then approval is still required', async () => {
    const cwd = await createTemporaryWorkspace('mico-permissions-')
    const result = await ToolRegistry.forWorkspace(cwd, {
      permissionMode: 'acceptEdits',
      hooks: { preToolUse: [async () => ({ behavior: 'ask', reason: '' })] }
    }).execute(writeCall, new AbortController().signal)
    expect(result.isError).toBe(true)
    await expect(access(join(cwd, 'created.txt'))).rejects.toThrow('ENOENT')
  })

  it.each(['.zshenv', '.zlogin', '.bash_login'])(
    'user writes %s when accepting edits, then shell startup changes require approval',
    async (file_path) => {
      const cwd = await createTemporaryWorkspace('mico-permissions-')
      const result = await ToolRegistry.forWorkspace(cwd, {
        permissionMode: 'acceptEdits'
      }).execute(
        { ...writeCall, input: { file_path, content: 'changed' } },
        new AbortController().signal
      )
      expect(result.isError).toBe(true)
      await expect(access(join(cwd, file_path))).rejects.toThrow('ENOENT')
    }
  )

  it('user rejects a Bash call when accepting edits, then the command creates no file', async () => {
    const cwd = await createTemporaryWorkspace('mico-permissions-')
    const result = await ToolRegistry.forWorkspace(cwd, {
      permissionMode: 'acceptEdits',
      requestApproval: async () => false
    }).execute(
      { toolCallId: 'bash-1', toolName: 'Bash', input: { command: 'echo changed > created.txt' } },
      new AbortController().signal
    )
    expect(result.isError).toBe(true)
    await expect(access(join(cwd, 'created.txt'))).rejects.toThrow('ENOENT')
  })

  it('user has a blocking hook when accepting edits, then the denied file is not created', async () => {
    const cwd = await createTemporaryWorkspace('mico-permissions-')
    const result = await ToolRegistry.forWorkspace(cwd, {
      permissionMode: 'acceptEdits',
      hooks: {
        preToolUse: [
          async () => ({ behavior: 'deny', reason: 'Project policy blocks this change.' })
        ]
      }
    }).execute(writeCall, new AbortController().signal)
    expect(result.output).toContain('Project policy blocks this change.')
    await expect(access(join(cwd, 'created.txt'))).rejects.toThrow('ENOENT')
  })

  it('user has a hook requiring confirmation when accepting edits, then rejection preserves the workspace', async () => {
    const cwd = await createTemporaryWorkspace('mico-permissions-')
    const result = await ToolRegistry.forWorkspace(cwd, {
      permissionMode: 'acceptEdits',
      hooks: { preToolUse: [async () => ({ behavior: 'ask', reason: 'Review this change.' })] },
      requestApproval: async () => false
    }).execute(writeCall, new AbortController().signal)
    expect(result.isError).toBe(true)
    await expect(access(join(cwd, 'created.txt'))).rejects.toThrow('ENOENT')
  })

  it('user approves a path changed by a symlink when waiting, then the new target remains untouched', async () => {
    const cwd = await createTemporaryWorkspace('mico-permissions-')
    await writeFile(join(cwd, 'ordinary.txt'), 'ordinary')
    await mkdir(join(cwd, '.git'))
    await writeFile(join(cwd, '.git', 'config'), 'protected')
    await symlink(join(cwd, 'ordinary.txt'), join(cwd, 'alias.txt'))
    const registry = ToolRegistry.forWorkspace(cwd, {
      requestApproval: async () => {
        await unlink(join(cwd, 'alias.txt'))
        await symlink(join(cwd, '.git', 'config'), join(cwd, 'alias.txt'))
        return true
      }
    })
    const result = await registry.execute(
      { ...writeCall, input: { file_path: 'alias.txt', content: 'changed' } },
      new AbortController().signal
    )
    expect(result.isError).toBe(true)
    expect(await readFile(join(cwd, '.git', 'config'), 'utf8')).toBe('protected')
  })

  it('user waits on a stalled hook when accepting edits, then the deadline prevents the write', async () => {
    const cwd = await createTemporaryWorkspace('mico-permissions-')
    vi.useFakeTimers()
    const started = Promise.withResolvers<void>()
    const result = ToolRegistry.forWorkspace(cwd, {
      permissionMode: 'acceptEdits',
      hooks: {
        preToolUse: [
          async () => {
            started.resolve()
            return new Promise(() => {})
          }
        ]
      }
    }).execute(writeCall, new AbortController().signal)
    await started.promise
    await vi.advanceTimersByTimeAsync(10_000)
    expect((await result).output).toContain('hook timed out')
    await expect(access(join(cwd, 'created.txt'))).rejects.toThrow('ENOENT')
  })

  it('user has a failing observer when an approved write completes, then the successful file result is preserved', async () => {
    const cwd = await createTemporaryWorkspace('mico-permissions-')
    // Main-process logging is an observer seam; keep expected failures out of test output.
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await ToolRegistry.forWorkspace(cwd, {
      permissionMode: 'acceptEdits',
      hooks: {
        postToolUse: [
          async () => {
            throw new Error('Observer unavailable')
          }
        ]
      }
    }).execute(writeCall, new AbortController().signal)
    expect(result.isError).toBe(false)
    expect(await readFile(join(cwd, 'created.txt'), 'utf8')).toBe('approved content')
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('postToolUse'))
  })
})
