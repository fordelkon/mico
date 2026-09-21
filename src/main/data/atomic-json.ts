import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Persist a JSON document by writing a sibling temporary file and renaming it
 * into place, so readers never observe a partially written file.
 */
async function writeJsonAtomically<T>(filePath: string, value: T): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.tmp`
  await writeFile(temporaryPath, JSON.stringify(value), 'utf8')
  await rename(temporaryPath, filePath)
}

export { writeJsonAtomically }
