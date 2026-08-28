import { app } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'

import icon from '../../build/icon.png?asset'
import { registerIpc } from './ipc'
import { MainWindowService } from './services/main-window-service'
import { PreferenceService } from './services/preference-service'
import { TrayService } from './services/tray-service'

const preferenceService = new PreferenceService()
let trayService: TrayService
const mainWindowService = new MainWindowService(() => trayService.shouldKeepWindowOpen())
trayService = new TrayService(mainWindowService)

void app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.electron')

  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(icon)
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  await preferenceService.initialize()
  mainWindowService.initialize()
  trayService.initialize()
  registerIpc({ mainWindow: mainWindowService, preference: preferenceService })

  app.on('activate', () => {
    mainWindowService.show()
  })
})

app.on('before-quit', () => {
  trayService.beginQuit()
  trayService.dispose()
})
