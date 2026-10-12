import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const temporaryPaths: string[] = []

/** Creates a temporary workspace directory and tracks it for removal by removeTemporaryPaths. */
export async function createTemporaryWorkspace(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix))
  temporaryPaths.push(path)
  return path
}

/**
 * Removes tracked workspaces after their operations have drained. Windows can
 * retain directory handles briefly after process exit; bounded fs retries cover
 * that release without hiding a live process or a persistent cleanup failure.
 */
export async function removeTemporaryPaths(): Promise<void> {
  await Promise.all(
    temporaryPaths.splice(0).map((path) =>
      rm(path, {
        force: true,
        recursive: true,
        maxRetries: process.platform === 'win32' ? 10 : 0,
        retryDelay: 100
      })
    )
  )
}
