import { electronApp, optimizer } from '@electron-toolkit/utils'
import { app } from 'electron'
import { Conversations } from './ai/conversation'
import { Models } from './ai/models'
import { Workspaces } from './ai/workspace'
import { SessionDatabase } from './data/session-database'
import { registerIpc } from './ipc'
import { MainWindowService } from './services/main-window-service'
import { PreferenceService } from './services/preference-service'
import { registerProviderDraftFlush } from './services/provider-draft-flush'
import { TrayService } from './services/tray-service'
import { registerAppQuitHandler } from './services/window-lifecycle'

type MainServices = {
  mainWindow: MainWindowService
  conversations: Conversations
  preference: PreferenceService
  models: Models
  sessionDatabase: SessionDatabase
  tray: TrayService
  workspace: Workspaces
}

/**
 * Create and initialize every main-process service in dependency order. The
 * provider draft flush listener registers here, before any window exists, so
 * a renderer can never flush into an unregistered channel.
 */
async function createMainServices(): Promise<MainServices> {
  const flushProviderDraft = registerProviderDraftFlush()
  const preference = new PreferenceService()
  const models = new Models()
  const sessionDatabase = new SessionDatabase()
  const workspace = new Workspaces()

  await preference.initialize()
  await models.initialize()
  await sessionDatabase.initialize()
  await workspace.initialize()

  const conversations = new Conversations({ database: sessionDatabase, models, workspace })
  conversations.recoverInterruptedRuns()

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
    conversations,
    preference,
    models,
    sessionDatabase,
    tray: trayService,
    workspace
  }
}

function startApp(services: MainServices): void {
  registerIpc({
    conversations: services.conversations,
    mainWindow: services.mainWindow,
    preference: services.preference,
    models: services.models,
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

// E2E and manual test runs redirect all persistence to an isolated directory.
// The single-instance lock is scoped to userData, so this also lets a test
// instance run beside the installed application.
const testUserDataDir = process.env['MICO_USER_DATA_DIR']
if (testUserDataDir) app.setPath('userData', testUserDataDir)

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

  registerAppQuitHandler({
    app,
    prepareToQuit: async () => {
      await startup
      services?.tray.beginQuit()
      services?.conversations.stopCompactions()
      try {
        await services?.mainWindow.prepareToQuit()
      } finally {
        await services?.conversations.drain()
      }
    },
    dispose: () => {
      try {
        services?.conversations.dispose()
      } finally {
        try {
          services?.sessionDatabase.close()
        } finally {
          services?.tray.dispose()
        }
      }
    }
  })
} else {
  app.quit()
}
