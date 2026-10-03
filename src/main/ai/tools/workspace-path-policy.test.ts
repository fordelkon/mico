import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveWorkspacePath } from './workspace-path-policy'
import { createTemporaryWorkspace, removeTemporaryPaths } from './test-helpers'

describe('resolveWorkspacePath', () => {
  afterEach(() => removeTemporaryPaths())

  async function createWorkspace(): Promise<string> {
    const workspace = join(await createTemporaryWorkspace('mico-tool-path-'), 'workspace')
    await mkdir(workspace)
    return workspace
  }

  it('user cannot read a file when a path escapes the workspace, then it is rejected', async () => {
    const workspace = await createWorkspace()

    await expect(resolveWorkspacePath(workspace, '../secret.txt')).rejects.toThrow(
      'Path must be inside the session workspace.'
    )
  })

  it('user cannot read a symlink when it escapes the workspace, then it is rejected', async () => {
    const workspace = await createWorkspace()
    const outside = join(workspace, '..', 'outside.txt')
    await writeFile(outside, 'secret')
    await symlink(outside, join(workspace, 'outside-link'))

    await expect(resolveWorkspacePath(workspace, 'outside-link')).rejects.toThrow(
      'Path must be inside the session workspace.'
    )
  })

  it('user cannot create a file when a parent symlink escapes, then it is rejected', async () => {
    const workspace = await createWorkspace()
    const outsideDirectory = join(workspace, '..', 'outside')
    await mkdir(outsideDirectory)
    await symlink(outsideDirectory, join(workspace, 'linked-directory'))

    await expect(
      resolveWorkspacePath(workspace, 'linked-directory/new.txt', { allowMissing: true })
    ).rejects.toThrow('Path must be inside the session workspace.')
  })

  it('user creates through a dangling symlink when its target is outside, then the path is rejected', async () => {
    const workspace = await createWorkspace()
    const outsideDirectory = join(workspace, '..', 'outside')
    await mkdir(outsideDirectory)
    await symlink(join(outsideDirectory, 'new.txt'), join(workspace, 'alias.txt'))
    await expect(
      resolveWorkspacePath(workspace, 'alias.txt', { allowMissing: true })
    ).rejects.toThrow('Path must be inside the session workspace.')
  })

  it('user follows a relative symlink with parent traversal when writing, then outside targets are rejected', async () => {
    const workspace = await createWorkspace()
    const outsideDirectory = join(workspace, '..', 'outside')
    await mkdir(join(outsideDirectory, 'child'), { recursive: true })
    await symlink(join(outsideDirectory, 'child'), join(workspace, 'pivot'))
    await symlink('pivot/../new.txt', join(workspace, 'alias.txt'))
    await expect(
      resolveWorkspacePath(workspace, 'alias.txt', { allowMissing: true })
    ).rejects.toThrow('Path must be inside the session workspace.')
  })

  it('user opens an absolute path when workspace uses an alias, then the equivalent path is accepted', async () => {
    const root = await createTemporaryWorkspace('mico-tool-path-')
    const workspace = join(root, 'workspace')
    const workspaceAlias = join(root, 'workspace-alias')
    await mkdir(workspace)
    await symlink(workspace, workspaceAlias, process.platform === 'win32' ? 'junction' : 'dir')
    const filePath = join(workspaceAlias, 'file.txt')
    await writeFile(join(workspace, 'file.txt'), 'contents')

    await expect(resolveWorkspacePath(workspaceAlias, filePath)).resolves.toBe(filePath)
  })

  it('user reads an outside alias when it points into workspace, then lexical escape is rejected', async () => {
    const root = await createTemporaryWorkspace('mico-tool-path-')
    const workspace = join(root, 'workspace')
    const outsideAlias = join(root, 'outside-alias')
    await mkdir(workspace)
    await writeFile(join(workspace, 'file.txt'), 'contents')
    await symlink(workspace, outsideAlias, process.platform === 'win32' ? 'junction' : 'dir')

    await expect(resolveWorkspacePath(workspace, join(outsideAlias, 'file.txt'))).rejects.toThrow(
      'Path must be inside the session workspace.'
    )
  })

  it('user creates through an outside alias when it points into workspace, then lexical escape is rejected', async () => {
    const root = await createTemporaryWorkspace('mico-tool-path-')
    const workspace = join(root, 'workspace')
    const outsideAlias = join(root, 'outside-alias')
    await mkdir(workspace)
    await symlink(workspace, outsideAlias, process.platform === 'win32' ? 'junction' : 'dir')

    await expect(
      resolveWorkspacePath(workspace, join(outsideAlias, 'new.txt'), { allowMissing: true })
    ).rejects.toThrow('Path must be inside the session workspace.')
  })
})
