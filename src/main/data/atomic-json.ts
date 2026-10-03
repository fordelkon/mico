import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Persist a JSON document by writing a sibling temporary file and renaming it
 * into place, so readers never observe a partially written file.
 */
async function writeJsonAtomically<T>(filePath: string, value: T): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, JSON.stringify(value), { encoding: 'utf8', flag: 'wx' })
    await rename(temporaryPath, filePath)
  } finally {
    // Cleanup must not replace the write failure that the caller needs to handle.
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

/** Serializes mutations of one document and publishes only committed snapshots. */
class JsonDocument<T> {
  #value: T
  #pending: Promise<void> = Promise.resolve()

  constructor(
    private readonly filePath: string,
    value: T
  ) {
    this.#value = structuredClone(value)
  }

  get value(): T {
    return structuredClone(this.#value)
  }

  update(change: (current: T) => T): Promise<T> {
    const task = this.#pending.then(async () => {
      const next = structuredClone(change(this.value))
      await writeJsonAtomically(this.filePath, next)
      this.#value = next
      return this.value
    })
    // A failed mutation leaves the committed value intact and permits later retries.
    this.#pending = task.then(
      () => undefined,
      () => undefined
    )
    return task
  }
}

export { JsonDocument }
