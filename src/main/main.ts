import { app, ipcMain, type BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'

import icon from '../../build/icons/512x512.png?asset'
import { createChatProviderResolver } from './ai/chat/chat-provider-resolver'
import { TurnExecutor } from './ai/chat/turn-executor'
import { createChatProvider } from '@mico/ai-providers'
import { IpcChannel } from '@shared/IpcChannel'
import { registerIpc } from './ipc'
import { MainWindowService } from './services/main-window-service'
import { PreferenceService } from './services/preference-service'
import { ProviderService } from './ai/providers/provider-service'
import { SessionRuntimeService } from './ai/sessions/session-runtime-service'
import { SessionDatabase } from './data/session-database'
import { TrayService } from './services/tray-service'

const preferenceService = new PreferenceService()
const providerService = new ProviderService()
const sessionDatabase = new SessionDatabase()
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
let turnExecutor: TurnExecutor | undefined
let sessionRuntimeService: SessionRuntimeService | undefined
const mainWindowService = new MainWindowService(
  () => trayService.shouldKeepWindowOpen(),
  flushProviderDraft
)
trayService = new TrayService(mainWindowService)

const gotTheLock = app.requestSingleInstanceLock()

app.on('child-process-gone', (_, details) => {
  console.error('[chat-renderer-debug] child-process-gone', details)
})

app.on('render-process-gone', (_, webContents, details) => {
  console.error('[chat-renderer-debug] render-process-gone', {
    details,
    webContentsId: webContents.id,
    url: webContents.getURL()
  })
})

app.on('web-contents-created', (_, webContents) => {
  webContents.on('console-message', ({ level, lineNumber, message, sourceId }) => {
    if (level !== 'error') return

    console.error('[chat-renderer-debug] renderer-console-error', {
      lineNumber,
      message,
      sourceId
    })
  })
  webContents.on('unresponsive', () => {
    console.error('[chat-renderer-debug] renderer-unresponsive', { webContentsId: webContents.id })
  })
})

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
    await sessionDatabase.initialize()
    sessionRuntimeService = new SessionRuntimeService({ database: sessionDatabase })
    sessionRuntimeService.recoverInterruptedRuns()
    turnExecutor = new TurnExecutor(
      createChatProviderResolver({
        createChatProvider,
        getSelectedChatConfiguration: () => providerService.getSelectedChatConfiguration()
      }),
      {
        getSelectedChatConfiguration: () => providerService.getSelectedChatConfiguration(),
        runtime: sessionRuntimeService
      }
    )
    mainWindowService.initialize()
    trayService.initialize()
    registerIpc({
      turnExecutor,
      mainWindow: mainWindowService,
      preference: preferenceService,
      provider: providerService,
      session: sessionRuntimeService
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
  turnExecutor?.dispose()
  sessionDatabase.close()
  trayService.beginQuit()
  trayService.dispose()
})
