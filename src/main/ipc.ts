import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'

import { AppearancePreferenceSchema } from '@shared/data/schemas/preference'
import type { DataFor } from '@shared/data/types'
import { IpcChannel } from '@shared/IpcChannel'
import type { MainWindowService } from './services/main-window-service'
import type { PreferenceService } from './services/preference-service'

type AppearancePreference = DataFor<'appearancePreference'>

interface IpcServices {
  mainWindow: MainWindowService
  preference: PreferenceService
}

function registerIpc({ mainWindow, preference }: IpcServices): void {
  const getCallingWindow = (event: IpcMainInvokeEvent): BrowserWindow => {
    if (
      event.senderFrame !== event.sender.mainFrame ||
      !mainWindow.isTrustedRendererUrl(event.senderFrame.url)
    ) {
      throw new Error('Untrusted window control sender')
    }

    const window = BrowserWindow.fromWebContents(event.sender)

    if (!window) {
      throw new Error('Window not found')
    }

    return window
  }

  ipcMain.handle(IpcChannel.WindowControls_Close, (event) =>
    mainWindow.close(getCallingWindow(event))
  )
  ipcMain.handle(IpcChannel.WindowControls_IsFullscreen, (event) =>
    mainWindow.isFullscreen(getCallingWindow(event))
  )
  ipcMain.handle(IpcChannel.WindowControls_IsMaximized, (event) =>
    mainWindow.isMaximized(getCallingWindow(event))
  )
  ipcMain.handle(IpcChannel.WindowControls_Maximize, (event) =>
    mainWindow.maximize(getCallingWindow(event))
  )
  ipcMain.handle(IpcChannel.WindowControls_Minimize, (event) =>
    mainWindow.minimize(getCallingWindow(event))
  )
  ipcMain.handle(IpcChannel.WindowControls_ToggleFullscreen, (event) =>
    mainWindow.toggleFullscreen(getCallingWindow(event))
  )
  ipcMain.handle(IpcChannel.WindowControls_Unmaximize, (event) =>
    mainWindow.unmaximize(getCallingWindow(event))
  )

  ipcMain.handle(IpcChannel.Appearance_GetPreference, (event) => {
    getCallingWindow(event)
    return preference.getAppearancePreference()
  })
  ipcMain.handle(IpcChannel.Appearance_GetResolved, (event) => {
    getCallingWindow(event)
    return preference.getResolvedAppearance()
  })
  ipcMain.handle(IpcChannel.Appearance_SetPreference, async (event, input: AppearancePreference) => {
    getCallingWindow(event)
    const result = AppearancePreferenceSchema.safeParse(input)
    if (!result.success) throw new Error('Invalid appearance preference')

    return preference.setAppearancePreference(result.data)
  })
}

export { registerIpc }
