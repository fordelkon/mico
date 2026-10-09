import { IpcChannel } from '@shared/IpcChannel'
import { ipcMain, type WebContents } from 'electron'

interface IpcMainListenerRegistrar {
  on(channel: string, listener: (event: { sender: Pick<WebContents, 'id'> }) => void): void
}

interface DraftFlushContents extends Pick<WebContents, 'id' | 'isDestroyed' | 'send'> {
  once(event: 'destroyed', listener: () => void): void
  removeListener(event: 'destroyed', listener: () => void): void
}

interface DraftFlushWindow {
  isDestroyed: () => boolean
  webContents: DraftFlushContents
}

const DRAFT_FLUSH_TIMEOUT_MS = 1_000

/**
 * Registers the renderer acknowledgement before any window exists. Concurrent
 * close and Quit requests share one bounded save attempt for the same renderer.
 * An acknowledgement means the attempt settled, including a failed save.
 */
function registerProviderDraftFlush(
  registrar: IpcMainListenerRegistrar = ipcMain
): (window: DraftFlushWindow) => Promise<void> {
  const pending = new Map<number, { promise: Promise<void>; complete: () => void }>()
  registrar.on(IpcChannel.Providers_DraftFlushed, (event) => {
    pending.get(event.sender.id)?.complete()
  })

  return (window: DraftFlushWindow): Promise<void> => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return Promise.resolve()

    const contents = window.webContents
    const webContentsId = contents.id
    const existing = pending.get(webContentsId)
    if (existing) return existing.promise

    const { promise, resolve } = Promise.withResolvers<void>()
    const complete = (): void => {
      clearTimeout(timeout)
      contents.removeListener('destroyed', complete)
      pending.delete(webContentsId)
      resolve()
    }
    const timeout = setTimeout(() => {
      console.error('Timed out draining provider drafts before closing', {
        webContentsId
      })
      complete()
    }, DRAFT_FLUSH_TIMEOUT_MS)
    pending.set(webContentsId, { promise, complete })
    contents.once('destroyed', complete)
    try {
      contents.send(IpcChannel.Providers_FlushDraft)
    } catch (error) {
      console.error('Failed to request provider draft drain before closing', {
        error,
        webContentsId
      })
      complete()
    }
    return promise
  }
}

export { registerProviderDraftFlush }
