import { app } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'

import { createChatProviderResolver } from './ai/chat/chat-provider-resolver'
import { TurnExecutor } from './ai/chat/turn-executor'
import { createChatProvider } from '@mico/ai-providers'
import { registerIpc } from './ipc'
import { MainWindowService } from './services/main-window-service'
import { PreferenceService } from './services/preference-service'
import { registerProviderDraftFlush } from './services/provider-draft-flush'
import { ProviderService } from './ai/providers/provider-service'
import { SessionRuntimeService } from './ai/sessions/session-runtime-service'
import { WorkspaceService } from './ai/workspaces/workspace-service'
import { SessionDatabase } from './data/session-database'
import { TrayService } from './services/tray-service'

type MainServices = {
  mainWindow: MainWindowService
  preference: PreferenceService
  provider: ProviderService
  sessionDatabase: SessionDatabase
  sessionRuntime: SessionRuntimeService
  tray: TrayService
  turnExecutor: TurnExecutor
  workspace: WorkspaceService
}

/**
 * Create and initialize every main-process service in dependency order. The
 * provider draft flush listener registers here, before any window exists, so
 * a renderer can never flush into an unregistered channel.
 */
async function createMainServices(): Promise<MainServices> {
  const flushProviderDraft = registerProviderDraftFlush()
  const preference = new PreferenceService()
  const provider = new ProviderService()
  const sessionDatabase = new SessionDatabase()
  const workspace = new WorkspaceService()

  await preference.initialize()
  await provider.initialize()
  await sessionDatabase.initialize()
  await workspace.initialize()

  const sessionRuntime = new SessionRuntimeService({ database: sessionDatabase })
  sessionRuntime.recoverInterruptedRuns()

  const getChatConfigurationForModelEntry = (
    modelEntryId: string
  ): ReturnType<ProviderService['getChatConfigurationForModelEntry']> =>
    provider.getChatConfigurationForModelEntry(modelEntryId)
  const turnExecutor = new TurnExecutor(
    createChatProviderResolver({
      createChatProvider,
      getChatConfigurationForModelEntry
    }),
    {
      getChatConfigurationForModelEntry,
      getSelectedModelEntryId: () => provider.getLibrary().selectedModelId,
      getSelectedChatConfiguration: () => provider.getSelectedChatConfiguration(),
      runtime: sessionRuntime
    }
  )

  // The tray is constructed after the window it monitors; the closure defers the
  // reference so the quit behavior reads the final tray instance.
  let trayService: TrayService
  const mainWindow = new MainWindowService(
    () => trayService.shouldKeepWindowOpen(),
    flushProviderDraft
  )
  trayService = new TrayService(mainWindow)

  mainWindow.initialize()
  trayService.initialize()

  return {
    mainWindow,
    preference,
    provider,
    sessionDatabase,
    sessionRuntime,
    tray: trayService,
    turnExecutor,
    workspace
  }
}

function startApp(services: MainServices): void {
  registerIpc({
    turnExecutor: services.turnExecutor,
    mainWindow: services.mainWindow,
    preference: services.preference,
    provider: services.provider,
    session: services.sessionRuntime,
    workspace: services.workspace
  })

  app.on('activate', () => {
    services.mainWindow.show()
  })
}

function watchDiagnostics(): void {
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
      console.error('[chat-renderer-debug] renderer-unresponsive', {
        webContentsId: webContents.id
      })
    })
  })
}

const gotTheLock = app.requestSingleInstanceLock()

if (gotTheLock) {
  watchDiagnostics()

  let services: MainServices | undefined
  const startup = app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.electron')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    services = await createMainServices()
    startApp(services)
  })

  app.on('second-instance', () => {
    void startup.then(() => services?.mainWindow.show())
  })

  app.on('before-quit', () => {
    services?.turnExecutor.dispose()
    services?.sessionDatabase.close()
    services?.tray.beginQuit()
    services?.tray.dispose()
  })
} else {
  app.quit()
}
