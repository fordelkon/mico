import { BrowserWindow, ipcMain, type IpcMain, type IpcMainInvokeEvent } from 'electron'

import { ChatRequestIdSchema, ChatStartRequestSchema } from '@shared/data/schemas/chat'
import { AppearancePreferenceSchema } from '@shared/data/schemas/preference'
import { IpcChannel } from '@shared/IpcChannel'
import type { ChatService } from './ai/chat-service'
import type { MainWindowService } from './services/main-window-service'
import type { PreferenceService } from './services/preference-service'

type IpcMainRegistrar = Pick<IpcMain, 'handle'>
type IpcDependencies = {
  getWindow: typeof BrowserWindow.fromWebContents
  ipcMain: IpcMainRegistrar
}

interface IpcServices {
  chat: Pick<ChatService, 'abort' | 'abortAll' | 'start'>
  mainWindow: Pick<
    MainWindowService,
    | 'close'
    | 'isFullscreen'
    | 'isMaximized'
    | 'isTrustedRendererUrl'
    | 'maximize'
    | 'minimize'
    | 'toggleFullscreen'
    | 'unmaximize'
  >
  preference: Pick<
    PreferenceService,
    'getAppearancePreference' | 'getResolvedAppearance' | 'setAppearancePreference'
  >
}

function registerIpc(
  { chat, mainWindow, preference }: IpcServices,
  dependencies: IpcDependencies = {
    getWindow: (webContents) => BrowserWindow.fromWebContents(webContents),
    ipcMain
  }
): void {
  const destroyedSenderIds = new Set<number>()
  const getCallingWindow = (event: IpcMainInvokeEvent): BrowserWindow => {
    if (
      event.senderFrame !== event.sender.mainFrame ||
      !mainWindow.isTrustedRendererUrl(event.senderFrame.url)
    ) {
      throw new Error('Untrusted window control sender')
    }

    const window = dependencies.getWindow(event.sender)

    if (!window) {
      throw new Error('Window not found')
    }

    return window
  }

  dependencies.ipcMain.handle(IpcChannel.WindowControls_Close, (event) =>
    mainWindow.close(getCallingWindow(event))
  )
  dependencies.ipcMain.handle(IpcChannel.WindowControls_IsFullscreen, (event) =>
    mainWindow.isFullscreen(getCallingWindow(event))
  )
  dependencies.ipcMain.handle(IpcChannel.WindowControls_IsMaximized, (event) =>
    mainWindow.isMaximized(getCallingWindow(event))
  )
  dependencies.ipcMain.handle(IpcChannel.WindowControls_Maximize, (event) =>
    mainWindow.maximize(getCallingWindow(event))
  )
  dependencies.ipcMain.handle(IpcChannel.WindowControls_Minimize, (event) =>
    mainWindow.minimize(getCallingWindow(event))
  )
  dependencies.ipcMain.handle(IpcChannel.WindowControls_ToggleFullscreen, (event) =>
    mainWindow.toggleFullscreen(getCallingWindow(event))
  )
  dependencies.ipcMain.handle(IpcChannel.WindowControls_Unmaximize, (event) =>
    mainWindow.unmaximize(getCallingWindow(event))
  )

  dependencies.ipcMain.handle(IpcChannel.Appearance_GetPreference, (event) => {
    getCallingWindow(event)
    return preference.getAppearancePreference()
  })
  dependencies.ipcMain.handle(IpcChannel.Appearance_GetResolved, (event) => {
    getCallingWindow(event)
    return preference.getResolvedAppearance()
  })
  dependencies.ipcMain.handle(IpcChannel.Appearance_SetPreference, async (event, input) => {
    getCallingWindow(event)
    const result = AppearancePreferenceSchema.safeParse(input)
    if (!result.success) throw new Error('Invalid appearance preference')

    return preference.setAppearancePreference(result.data)
  })

  dependencies.ipcMain.handle(IpcChannel.Chat_Start, (event, input) => {
    getCallingWindow(event)
    const result = ChatStartRequestSchema.safeParse(input)
    if (!result.success) throw new Error('Invalid chat request')

    const ownerId = String(event.sender.id)
    if (!destroyedSenderIds.has(event.sender.id)) {
      destroyedSenderIds.add(event.sender.id)
      event.sender.once('destroyed', () => {
        destroyedSenderIds.delete(event.sender.id)
        chat.abortAll(ownerId)
      })
    }

    chat.start({ ownerId, request: result.data }, (chatEvent) => {
      event.sender.send(IpcChannel.Chat_Event, chatEvent)
    })
  })
  dependencies.ipcMain.handle(IpcChannel.Chat_Abort, (event, input) => {
    getCallingWindow(event)
    const result = ChatRequestIdSchema.safeParse(input)
    if (!result.success) throw new Error('Invalid chat request')

    chat.abort({ ownerId: String(event.sender.id), requestId: result.data })
  })
}

export { registerIpc }
