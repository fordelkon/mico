import { app, ipcMain, type BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'

import icon from '../../build/icon.png?asset'
import { ChatService } from './ai/chat-service'
import { createChatProviderResolver } from './ai/chat-provider-resolver'
import { createChatProvider } from '@mico/ai-providers'
import { IpcChannel } from '@shared/IpcChannel'
import { registerIpc } from './ipc'
import { MainWindowService } from './services/main-window-service'
import { PreferenceService } from './services/preference-service'
import { ProviderService } from './services/provider-service'
import { TrayService } from './services/tray-service'

const preferenceService = new PreferenceService()
const providerService = new ProviderService()
const pendingProviderDraftFlushes = new Map<number, () => void>()
ipcMain.on(IpcChannel.Providers_DraftFlushed, (event) => {
  pendingProviderDraftFlushes.get(event.sender.id)?.()
})

function flushProviderDraft(window: BrowserWindow): Promise<void> {
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

let trayService: TrayService
let chatService: ChatService | undefined
const mainWindowService = new MainWindowService(
  () => trayService.shouldKeepWindowOpen(),
  flushProviderDraft
)
trayService = new TrayService(mainWindowService)

const gotTheLock = app.requestSingleInstanceLock()

if (gotTheLock) {
  const startup = app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.electron')

    if (process.platform === 'darwin' && app.dock) {
      app.dock.setIcon(icon)
    }

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    await preferenceService.initialize()
    await providerService.initialize()
    chatService = new ChatService(
      createChatProviderResolver({
        createChatProvider,
        getSelectedChatConfiguration: () => providerService.getSelectedChatConfiguration()
      })
    )
    mainWindowService.initialize()
    trayService.initialize()
    registerIpc({
      chat: chatService,
      mainWindow: mainWindowService,
      preference: preferenceService,
      provider: providerService
    })

    app.on('activate', () => {
      mainWindowService.show()
    })
  })

  app.on('second-instance', () => {
    void startup.then(() => mainWindowService.show())
  })
} else {
  app.quit()
}

app.on('before-quit', () => {
  chatService?.dispose()
  trayService.beginQuit()
  trayService.dispose()
})
