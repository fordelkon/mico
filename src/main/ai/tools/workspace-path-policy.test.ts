import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveWorkspacePath } from './workspace-path-policy'

describe('resolveWorkspacePath', () => {
  const temporaryPaths: string[] = []

  afterEach(async () => {
    await Promise.all(
      temporaryPaths.splice(0).map((path) => rm(path, { force: true, recursive: true }))
    )
  })

  it('rejects a lexical path outside the session cwd', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mico-tool-path-'))
    temporaryPaths.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace)

    await expect(resolveWorkspacePath(workspace, '../secret.txt')).rejects.toThrow(
      'Path must be inside the session workspace.'
    )
  })

  it('rejects a symlink that resolves outside the session cwd', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mico-tool-path-'))
    temporaryPaths.push(root)
    const workspace = join(root, 'workspace')
    const outside = join(root, 'outside.txt')
    await mkdir(workspace)
    await writeFile(outside, 'secret')
    await symlink(outside, join(workspace, 'outside-link'))

    await expect(resolveWorkspacePath(workspace, 'outside-link')).rejects.toThrow(
      'Path must be inside the session workspace.'
    )
  })

  it('rejects a new file beneath a symlinked parent outside the session cwd', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mico-tool-path-'))
    temporaryPaths.push(root)
    const workspace = join(root, 'workspace')
    const outsideDirectory = join(root, 'outside')
    await mkdir(workspace)
    await mkdir(outsideDirectory)
    await symlink(outsideDirectory, join(workspace, 'linked-directory'))

    await expect(
      resolveWorkspacePath(workspace, 'linked-directory/new.txt', { allowMissing: true })
    ).rejects.toThrow('Path must be inside the session workspace.')
  })
})
