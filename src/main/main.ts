import { app } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'

import icon from '../../build/icon.png?asset'
import { ChatService } from './ai/chat-service'
import { createChatProviderResolver } from './ai/chat-provider-resolver'
import { createChatProvider } from '@mico/ai-providers'
import { registerIpc } from './ipc'
import { MainWindowService } from './services/main-window-service'
import { PreferenceService } from './services/preference-service'
import { ProviderService } from './services/provider-service'
import { TrayService } from './services/tray-service'

const preferenceService = new PreferenceService()
const providerService = new ProviderService()
let trayService: TrayService
let chatService: ChatService | undefined
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

app.on('before-quit', () => {
  chatService?.dispose()
  trayService.beginQuit()
  trayService.dispose()
})
