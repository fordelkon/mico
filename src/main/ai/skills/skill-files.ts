import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path'

const MAX_SKILL_OUTPUT_BYTES = 48 * 1024

function assertContained(root: string, target: string): void {
  const path = relative(root, target)
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error('Path must stay inside the skill directory.')
  }
}

function resolveResourcePath(base: string, path: string): string {
  if (
    !path ||
    path.includes('\0') ||
    isAbsolute(path) ||
    win32.isAbsolute(path) ||
    path.includes('\\') ||
    path.split('/').includes('..')
  ) {
    throw new Error('Resource path must be relative and inside the skill directory.')
  }
  const target = resolve(base, path)
  assertContained(base, target)
  return target
}

async function readSkillFile(root: string, target: string, maxBytes: number): Promise<string> {
  assertContained(root, target)
  const canonical = await realpath(target)
  assertContained(root, canonical)
  // Nonblocking open lets us reject FIFOs without waiting for a writer before stat.
  const handle = await open(
    canonical,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  )
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('Skill resources must be a regular file.')
    if (stat.size > maxBytes) throw new Error('Skill text exceeds the 48 KiB output limit.')
    const buffer = Buffer.alloc(maxBytes + 1)
    let bytesRead = 0
    while (bytesRead < buffer.length) {
      const result = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead)
      if (result.bytesRead === 0) break
      bytesRead += result.bytesRead
    }
    if (bytesRead > maxBytes) throw new Error('Skill text exceeds the 48 KiB output limit.')
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))
    } catch (error) {
      throw new Error('Skill resources must contain valid UTF-8 text.', { cause: error })
    }
    if (text.includes('\0'))
      throw new Error('Skill resources must contain UTF-8 text without NUL bytes.')
    return text
  } finally {
    await handle.close()
  }
}

function assertOutputSize(text: string): string {
  if (Buffer.byteLength(text, 'utf8') > MAX_SKILL_OUTPUT_BYTES) {
    throw new Error('Skill text exceeds the 48 KiB output limit.')
  }
  return text
}

export {
  assertContained,
  assertOutputSize,
  MAX_SKILL_OUTPUT_BYTES,
  readSkillFile,
  resolveResourcePath
}
