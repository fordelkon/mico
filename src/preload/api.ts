import { ipcRenderer, type IpcRendererEvent } from 'electron'

import type { AppearanceAPI } from '@shared/ipc/schemas/appearance'
import type { ChatAPI } from '@shared/ipc/schemas/chat'
import type { WindowControlsAPI } from '@shared/ipc/schemas/window-controls'
import { IpcChannel } from '@shared/IpcChannel'

const windowControls: WindowControlsAPI = {
  close: () => ipcRenderer.invoke(IpcChannel.WindowControls_Close),
  isFullScreen: () => ipcRenderer.invoke(IpcChannel.WindowControls_IsFullscreen),
  isMaximized: () => ipcRenderer.invoke(IpcChannel.WindowControls_IsMaximized),
  maximize: () => ipcRenderer.invoke(IpcChannel.WindowControls_Maximize),
  minimize: () => ipcRenderer.invoke(IpcChannel.WindowControls_Minimize),
  onFullScreenChange: (listener) => {
    const wrappedListener = (_event: IpcRendererEvent, isFullScreen: boolean): void => {
      listener(isFullScreen)
    }

    ipcRenderer.on(IpcChannel.WindowControls_FullscreenChanged, wrappedListener)

    return () =>
      ipcRenderer.removeListener(IpcChannel.WindowControls_FullscreenChanged, wrappedListener)
  },
  onMaximizedChange: (listener) => {
    const wrappedListener = (_event: IpcRendererEvent, isMaximized: boolean): void => {
      listener(isMaximized)
    }

    ipcRenderer.on(IpcChannel.WindowControls_MaximizedChanged, wrappedListener)

    return () =>
      ipcRenderer.removeListener(IpcChannel.WindowControls_MaximizedChanged, wrappedListener)
  },
  toggleFullScreen: () => ipcRenderer.invoke(IpcChannel.WindowControls_ToggleFullscreen),
  unmaximize: () => ipcRenderer.invoke(IpcChannel.WindowControls_Unmaximize)
}

const appearance: AppearanceAPI = {
  getPreference: () => ipcRenderer.invoke(IpcChannel.Appearance_GetPreference),
  getResolvedAppearance: () => ipcRenderer.invoke(IpcChannel.Appearance_GetResolved),
  onAppearanceChange: (listener) => {
    const wrappedListener = (_event: IpcRendererEvent, nextAppearance: 'light' | 'dark'): void => {
      listener(nextAppearance)
    }

    ipcRenderer.on(IpcChannel.Appearance_Changed, wrappedListener)
    return () => ipcRenderer.removeListener(IpcChannel.Appearance_Changed, wrappedListener)
  },
  setPreference: (preference) => ipcRenderer.invoke(IpcChannel.Appearance_SetPreference, preference)
}

const chat: ChatAPI = {
  abort: (requestId) => ipcRenderer.invoke(IpcChannel.Chat_Abort, requestId),
  onEvent: (listener) => {
    const wrappedListener = (
      _event: IpcRendererEvent,
      chatEvent: Parameters<typeof listener>[0]
    ): void => {
      listener(chatEvent)
    }

    ipcRenderer.on(IpcChannel.Chat_Event, wrappedListener)
    return () => ipcRenderer.removeListener(IpcChannel.Chat_Event, wrappedListener)
  },
  start: (request) => ipcRenderer.invoke(IpcChannel.Chat_Start, request)
}

const api = { appearance, chat, windowControls }

export { api, type WindowApiType }

type WindowApiType = typeof api
