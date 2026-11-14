import { type BigIntStats, constants } from 'node:fs'
import { type FileHandle, lstat, open, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep, win32 } from 'node:path'

const MAX_SKILL_RESOURCE_BYTES = 48 * 1024
// Instruction documents have a separate budget so long skills remain usable without
// expanding the output allowance for arbitrary references.
const MAX_SKILL_DOCUMENT_BYTES = 256 * 1024

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

interface PathIdentity {
  readonly path: string
  readonly stat: BigIntStats
}

function assertIdentity(expected: BigIntStats, actual: BigIntStats): void {
  if (expected.dev !== actual.dev || expected.ino !== actual.ino) {
    throw new Error('Skill resource path changed while reading. Retry in a new turn.')
  }
}

async function capturePath(path: string): Promise<readonly PathIdentity[]> {
  const parent = dirname(path)
  const ancestors = parent === path ? [] : await capturePath(parent)
  return [...ancestors, { path, stat: await lstat(path, { bigint: true }) }]
}

async function verifyPath(
  target: string,
  canonical: string,
  identities: readonly PathIdentity[],
  lexicalIdentities: readonly PathIdentity[],
  handle: FileHandle
): Promise<void> {
  if ((await realpath(target)) !== canonical) {
    throw new Error('Skill resource path changed while reading. Retry in a new turn.')
  }
  for (const identity of [...lexicalIdentities, ...identities]) {
    assertIdentity(identity.stat, await lstat(identity.path, { bigint: true }))
  }
  assertIdentity(identities[identities.length - 1]!.stat, await handle.stat({ bigint: true }))
}

async function readSkillFile(
  root: string,
  target: string,
  maxBytes: number,
  expectedCanonical?: string
): Promise<string> {
  const canonical = await realpath(target)
  if (expectedCanonical !== undefined && canonical !== expectedCanonical) {
    throw new Error('Skill resource path changed while reading. Retry in a new turn.')
  }
  assertContained(root, canonical)
  // Capture both lexical links and canonical ancestors: O_NOFOLLOW protects only the leaf.
  const lexicalIdentities = await capturePath(target)
  const identities = await capturePath(canonical)
  // Nonblocking open lets us reject FIFOs without waiting for a writer before stat.
  const handle = await open(
    canonical,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  )
  try {
    await verifyPath(target, canonical, identities, lexicalIdentities, handle)
    const stat = await handle.stat({ bigint: true })
    if (!stat.isFile()) throw new Error('Skill resources must be a regular file.')
    if (stat.size > BigInt(maxBytes))
      throw new Error(`Skill text exceeds the ${Math.ceil(maxBytes / 1024)} KiB output limit.`)
    const buffer = Buffer.alloc(maxBytes + 1)
    let bytesRead = 0
    while (bytesRead < buffer.length) {
      const result = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead)
      if (result.bytesRead === 0) break
      bytesRead += result.bytesRead
    }
    await verifyPath(target, canonical, identities, lexicalIdentities, handle)
    if (bytesRead > maxBytes)
      throw new Error(`Skill text exceeds the ${Math.ceil(maxBytes / 1024)} KiB output limit.`)
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

function assertOutputSize(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new Error(`Skill text exceeds the ${Math.ceil(maxBytes / 1024)} KiB output limit.`)
  }
  return text
}

export {
  assertContained,
  assertOutputSize,
  MAX_SKILL_DOCUMENT_BYTES,
  MAX_SKILL_RESOURCE_BYTES,
  readSkillFile,
  resolveResourcePath
}
