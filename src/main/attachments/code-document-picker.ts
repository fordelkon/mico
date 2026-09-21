import { open } from 'node:fs/promises'
import { basename, extname } from 'node:path'

import type { BrowserWindow } from 'electron'

import {
  ChatDocumentPartSchema,
  CodeDocumentExtensions,
  CodeDocumentMaxNameLength,
  CodeDocumentMaxTextBytes,
  CodeDocumentsMaxTextBytes
} from '@shared/data/schemas/chat'
import type { ChatDocumentPart } from '@shared/data/schemas/chat'

type IpcFileHandle = Pick<Awaited<ReturnType<typeof open>>, 'close' | 'read'>
type CodeDocumentPickerDependencies = {
  pickCodeDocuments: (window: BrowserWindow) => Promise<{ canceled: boolean; filePaths: string[] }>
  openFile: (filePath: string) => Promise<IpcFileHandle>
  stat: (filePath: string) => Promise<{ size: number }>
}

const maxDocumentReadBytes = CodeDocumentMaxTextBytes + 1

async function readBoundedFile(
  openFile: CodeDocumentPickerDependencies['openFile'],
  filePath: string,
  maxBytes: number
): Promise<Uint8Array> {
  const handle = await openFile(filePath)
  try {
    const bytes = new Uint8Array(maxBytes)
    let totalBytesRead = 0
    while (totalBytesRead < maxBytes) {
      const { bytesRead } = await handle.read(
        bytes,
        totalBytesRead,
        maxBytes - totalBytesRead,
        totalBytesRead
      )
      if (bytesRead === 0) return bytes.subarray(0, totalBytesRead)
      totalBytesRead += bytesRead
    }
    return bytes
  } finally {
    await handle.close()
  }
}

/**
 * Open the native document picker and read the selection as chat documents,
 * enforcing the attachment policy: supported extensions, name and size limits,
 * a combined total limit, and UTF-8 decodability. Every rejection explains
 * what the user can change to proceed.
 */
async function pickCodeDocuments(
  window: BrowserWindow,
  dependencies: CodeDocumentPickerDependencies
): Promise<ChatDocumentPart[]> {
  let selection: { canceled: boolean; filePaths: string[] }
  try {
    selection = await dependencies.pickCodeDocuments(window)
  } catch {
    throw new Error('Unable to open the document picker. Please try again.')
  }
  if (selection.canceled) return []

  const documents: ChatDocumentPart[] = []
  let totalBytes = 0
  for (const filePath of selection.filePaths) {
    const name = basename(filePath)
    // SAFETY: `includes` compares an extension string against this readonly allowlist.
    if (
      !CodeDocumentExtensions.includes(extname(name) as (typeof CodeDocumentExtensions)[number])
    ) {
      throw new Error('Only code and text documents can be attached.')
    }
    if (name.length > CodeDocumentMaxNameLength) {
      throw new Error(`"${name}" is too long. Shorten or rename it and try again.`)
    }

    let fileSize: number
    try {
      fileSize = (await dependencies.stat(filePath)).size
    } catch {
      throw new Error(
        `Unable to inspect "${name}". Check that the file still exists and try again.`
      )
    }
    if (fileSize > CodeDocumentMaxTextBytes) {
      throw new Error(`"${name}" is larger than 256 KiB. Choose a smaller file and try again.`)
    }
    if (totalBytes + fileSize > CodeDocumentsMaxTextBytes) {
      throw new Error(
        'Selected documents exceed the 1 MiB total limit. Choose fewer or smaller files and try again.'
      )
    }

    let bytes: Uint8Array
    try {
      bytes = await readBoundedFile(dependencies.openFile, filePath, maxDocumentReadBytes)
    } catch {
      throw new Error(`Unable to read "${name}". Check that the file is accessible and try again.`)
    }
    if (bytes.byteLength > CodeDocumentMaxTextBytes) {
      throw new Error(`"${name}" is larger than 256 KiB. Choose a smaller file and try again.`)
    }
    if (totalBytes + bytes.byteLength > CodeDocumentsMaxTextBytes) {
      throw new Error(
        'Selected documents exceed the 1 MiB total limit. Choose fewer or smaller files and try again.'
      )
    }

    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw new Error(
        `"${name}" is not valid UTF-8 text. Choose a UTF-8 encoded file and try again.`
      )
    }
    documents.push(ChatDocumentPartSchema.parse({ type: 'document', name, text }))
    totalBytes += bytes.byteLength
  }

  return documents
}

export { pickCodeDocuments }
export type { CodeDocumentPickerDependencies, IpcFileHandle }
