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
 * Removes every tracked path. Pass rm options such as retries when cleanup races
 * child processes still holding a workspace open.
 */
export async function removeTemporaryPaths(
  options: { maxRetries?: number; retryDelay?: number } = {}
): Promise<void> {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { force: true, recursive: true, ...options }))
  )
}
