import { realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

type ResolveWorkspacePathOptions = { allowMissing?: boolean }

async function resolveExistingParent(path: string): Promise<string> {
  let candidate = path
  for (;;) {
    try {
      return await realpath(candidate)
    } catch (error) {
      if (!(error instanceof Error) || !isMissingPathError(error)) throw error
      const parent = dirname(candidate)
      if (parent === candidate) throw error
      candidate = parent
    }
  }
}

function isMissingPathError(error: Error): boolean {
  return error.message.includes('ENOENT')
}

function isWithinWorkspace(workspace: string, target: string): boolean {
  const pathFromWorkspace = relative(workspace, target)
  return (
    pathFromWorkspace === '' ||
    (!pathFromWorkspace.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
      pathFromWorkspace !== '..' &&
      !isAbsolute(pathFromWorkspace))
  )
}

async function resolveWorkspacePath(
  cwd: string,
  requestedPath: string,
  { allowMissing = false }: ResolveWorkspacePathOptions = {}
): Promise<string> {
  const lexicalWorkspace = resolve(cwd)
  const workspace = await realpath(lexicalWorkspace)
  const candidate = resolve(lexicalWorkspace, requestedPath)
  if (!isWithinWorkspace(lexicalWorkspace, candidate))
    throw new Error('Path must be inside the session workspace.')
  const resolvedTarget = allowMissing
    ? await resolveExistingParent(candidate)
    : await realpath(candidate)

  if (!isWithinWorkspace(workspace, resolvedTarget))
    throw new Error('Path must be inside the session workspace.')

  return candidate
}

export { resolveWorkspacePath, type ResolveWorkspacePathOptions }
