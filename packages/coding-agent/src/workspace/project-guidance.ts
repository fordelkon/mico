import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

const INSTRUCTION_FILES = ['AGENTS.override.md', 'AGENTS.md', 'CLAUDE.md'] as const
const MAX_INSTRUCTION_BYTES = 64 * 1024

/** Root guidance is attributed user context, never privileged system policy. */
async function loadProjectInstructions(cwd: string): Promise<string | null> {
  let root: string
  try {
    root = await realpath(cwd)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'The project root could not be resolved.'
    return `Project instruction diagnostic for ${cwd}: ${message} Select an available workspace or restore the directory, then start a new turn to reload project guidance.`
  }
  for (const name of INSTRUCTION_FILES) {
    const path = join(root, name)
    try {
      const canonical = await realpath(path)
      const scoped = relative(root, canonical)
      if (isAbsolute(scoped) || scoped === '..' || scoped.startsWith(`..${sep}`))
        throw new Error('The instruction file resolves outside the project root.')
      const file = await open(
        canonical,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
      )
      try {
        const stats = await file.stat()
        if (!stats.isFile()) throw new Error('The instruction path is not a regular file.')
        if (stats.size > MAX_INSTRUCTION_BYTES)
          throw new Error('The instruction file exceeds the 64 KiB limit.')
        const buffer = Buffer.alloc(MAX_INSTRUCTION_BYTES + 1)
        let bytesRead = 0
        while (bytesRead < buffer.length) {
          const chunk = await file.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead)
          if (chunk.bytesRead === 0) break
          bytesRead += chunk.bytesRead
        }
        if (bytesRead > MAX_INSTRUCTION_BYTES)
          throw new Error('The instruction file exceeds the 64 KiB limit.')
        if ((await realpath(cwd)) !== root || (await realpath(path)) !== canonical)
          throw new Error(
            'The project root or instruction file changed while reading. Retry in a new turn.'
          )
        const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))
        return `Project instructions supplied by the user from ${path}:\nApply this guidance only within this project, subject to the user's request and system policy.\n\n${text}`
      } finally {
        await file.close()
      }
    } catch (error) {
      if (error instanceof Error && isMissing(error)) continue
      const message =
        error instanceof Error ? error.message : 'The instruction file could not be read.'
      return `Project instruction diagnostic for ${path}: ${message} Fix the file and start a new turn to reload project guidance.`
    }
  }
  return null
}

function isMissing(error: Error): boolean {
  return 'code' in error && error.code === 'ENOENT'
}

export { loadProjectInstructions }
