import { ipcMain, type BrowserWindow, type IpcMain } from 'electron'

import { IpcChannel } from '@shared/IpcChannel'

type IpcMainListenerRegistrar = Pick<IpcMain, 'on'>

/**
 * The renderer buffers provider setting drafts and persists them through the
 * main process. Before a window closes or the app quits, the owner asks the
 * renderer to flush its drafts over `Providers_FlushDraft`; the renderer
 * acknowledges on `Providers_DraftFlushed`. Returns the flush function once
 * the listener is registered, so callers can order registration before any
 * window that could flush exists.
 */
function registerProviderDraftFlush(
  registrar: IpcMainListenerRegistrar = ipcMain
): (window: BrowserWindow) => Promise<void> {
  const pendingProviderDraftFlushes = new Map<number, () => void>()
  registrar.on(IpcChannel.Providers_DraftFlushed, (event) => {
    pendingProviderDraftFlushes.get(event.sender.id)?.()
  })

  return (window: BrowserWindow): Promise<void> => {
    return new Promise((resolve) => {
      const webContentsId = window.webContents.id
      const timeout = setTimeout(() => complete(), 1_000)
      const complete = (): void => {
        clearTimeout(timeout)
        pendingProviderDraftFlushes.delete(webContentsId)
        resolve()
      }

      // A renderer may already be gone during OS shutdown; time out rather than preventing the application from exiting.
      pendingProviderDraftFlushes.set(webContentsId, complete)
      window.webContents.send(IpcChannel.Providers_FlushDraft)
    })
  }
}

export { registerProviderDraftFlush }
