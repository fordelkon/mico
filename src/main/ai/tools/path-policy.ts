import { lstat, readlink, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

type ResolveWorkspacePathOptions = { allowMissing?: boolean }
type WorkspacePath = {
  path: string
  isProtected: boolean
  /** Checks containment and identity again after an approval wait. */
  revalidate: () => Promise<void>
}

const PROTECTED_DIRECTORIES = new Set(['.git', '.mico', '.claude', '.vscode'])
const PROTECTED_FILES = new Set([
  '.bashrc',
  '.bash_profile',
  '.bash_login',
  '.bash_logout',
  '.profile',
  '.zshrc',
  '.zprofile',
  '.zshenv',
  '.zlogin',
  '.zlogout',
  'config.fish'
])

function isProtectedPath(cwd: string, path: string): boolean {
  const segments = relative(cwd, path).split(sep)
  const name = basename(path).toLowerCase()
  return (
    segments.some((segment) => PROTECTED_DIRECTORIES.has(segment.toLowerCase())) ||
    name === '.env' ||
    name.startsWith('.env.') ||
    PROTECTED_FILES.has(name)
  )
}

/** Matches one `..` path segment with its preceding separator. */
const DOT_DOT_SEGMENT = /(^|[\\/])\.\.(?=[\\/]|$)/

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
      return resolveDotDotTarget(target, followedLinks + 1)
    }
    const parent = dirname(path)
    if (parent === path) throw error
    return resolve(await resolveMissingPath(parent, followedLinks), basename(path))
  }
}

/**
 * Resolves a link target that contains `..` segments. Windows realpath
 * normalizes '..' lexically before following preceding symlinks, which would
 * silently retarget "link/../file" to the link's lexical parent; POSIX follows
 * the link first. Each '..' is therefore applied against the fully resolved
 * prefix (symlinks followed), one segment at a time.
 */
async function resolveDotDotTarget(target: string, followedLinks: number): Promise<string> {
  const dotDot = DOT_DOT_SEGMENT.exec(target)
  if (!dotDot) return resolveMissingPath(target, followedLinks)

  const base = target.slice(0, dotDot.index) + dotDot[1]
  const suffix = target.slice(dotDot.index + dotDot[0].length)
  const resolvedBase = await resolveMissingPath(base, followedLinks)
  const applied = resolve(resolvedBase, '..')
  return resolveMissingPath(suffix ? `${applied}${sep}${suffix}` : applied, followedLinks + 1)
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

async function resolveTarget(
  cwd: string,
  requestedPath: string,
  { allowMissing = false }: ResolveWorkspacePathOptions = {}
): Promise<{ path: string; canonical: string; isProtected: boolean }> {
  const lexicalWorkspace = resolve(cwd)
  const workspace = await realpath(lexicalWorkspace)
  const candidate = resolve(lexicalWorkspace, requestedPath)
  if (!isWithinWorkspace(lexicalWorkspace, candidate))
    throw new Error('Path must be inside the session workspace.')
  const resolvedTarget = await resolveCanonicalPath(candidate, { allowMissing })

  if (!isWithinWorkspace(workspace, resolvedTarget))
    throw new Error('Path must be inside the session workspace.')

  return {
    path: candidate,
    canonical: resolvedTarget,
    isProtected:
      isProtectedPath(lexicalWorkspace, candidate) || isProtectedPath(workspace, resolvedTarget)
  }
}

async function resolveWorkspacePath(
  cwd: string,
  requestedPath: string,
  options: ResolveWorkspacePathOptions = {}
): Promise<WorkspacePath> {
  const target = await resolveTarget(cwd, requestedPath, options)
  return {
    path: target.path,
    isProtected: target.isProtected,
    revalidate: async () => {
      const current = await resolveTarget(cwd, requestedPath, options)
      if (current.canonical !== target.canonical)
        throw new Error(
          'The file target changed while waiting for approval. The operation was not executed. Review the new target and request approval again.'
        )
    }
  }
}

export { resolveWorkspacePath, type WorkspacePath }
