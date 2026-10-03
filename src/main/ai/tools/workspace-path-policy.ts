import { lstat, readlink, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

type ResolveWorkspacePathOptions = { allowMissing?: boolean }

async function resolveMissingPath(path: string, followedLinks = 0): Promise<string> {
  try {
    return await realpath(path)
  } catch (error) {
    if (!(error instanceof Error) || !isMissingPathError(error)) throw error
    // ENOENT may describe a dangling symlink, not an ordinary missing file.
    // Preserve its target before resolving the nearest existing ancestor.
    let link: string | undefined
    try {
      if ((await lstat(path)).isSymbolicLink()) link = await readlink(path)
    } catch (statError) {
      if (!(statError instanceof Error) || !isMissingPathError(statError)) throw statError
    }
    if (link !== undefined) {
      if (followedLinks >= 40) throw new Error('Too many symbolic links in the requested path.')
      // Do not normalize '..' before realpath follows preceding symlinks:
      // "pivot/../file" may refer to the parent of an outside link target.
      const target = isAbsolute(link) ? link : `${dirname(path)}${sep}${link}`
      return resolveMissingPath(target, followedLinks + 1)
    }
    const parent = dirname(path)
    if (parent === path) throw error
    return resolve(await resolveMissingPath(parent, followedLinks), basename(path))
  }
}

/** Resolves the actual target, retaining missing suffixes and following dangling links. */
async function resolveCanonicalPath(
  path: string,
  { allowMissing = false }: ResolveWorkspacePathOptions = {}
): Promise<string> {
  return allowMissing ? resolveMissingPath(path) : realpath(path)
}

function isMissingPathError(error: Error): boolean {
  return 'code' in error && error.code === 'ENOENT'
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
  const resolvedTarget = await resolveCanonicalPath(candidate, { allowMissing })

  if (!isWithinWorkspace(workspace, resolvedTarget))
    throw new Error('Path must be inside the session workspace.')

  return candidate
}

export { resolveCanonicalPath, resolveWorkspacePath, type ResolveWorkspacePathOptions }
