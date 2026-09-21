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
})
