import { ipcRenderer, type IpcRendererEvent } from 'electron'

import type { AppearanceAPI } from '@shared/ipc/schemas/appearance'
import type { ChatAPI } from '@shared/ipc/schemas/chat'
import type { ProvidersAPI } from '@shared/ipc/schemas/providers'
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
  getCapabilities: () => ipcRenderer.invoke(IpcChannel.Chat_GetCapabilities),
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

const providers: ProvidersAPI = {
  addCustomProvider: (provider) =>
    ipcRenderer.invoke(IpcChannel.Providers_AddCustomProvider, provider),
  updateCustomProvider: (provider) =>
    ipcRenderer.invoke(IpcChannel.Providers_UpdateCustomProvider, provider),
  removeCustomProvider: (providerId) =>
    ipcRenderer.invoke(IpcChannel.Providers_RemoveCustomProvider, providerId),
  addModel: (model) => ipcRenderer.invoke(IpcChannel.Providers_AddModel, model),
  discoverModels: (configuration) =>
    ipcRenderer.invoke(IpcChannel.Providers_DiscoverModels, configuration),
  getLibrary: () => ipcRenderer.invoke(IpcChannel.Providers_GetLibrary),
  saveLibrary: (library) => ipcRenderer.invoke(IpcChannel.Providers_SaveLibrary, library),
  importModel: (model) => ipcRenderer.invoke(IpcChannel.Providers_ImportModel, model),
  setModelEnabled: (model) => ipcRenderer.invoke(IpcChannel.Providers_SetModelEnabled, model),
  syncModels: (models) => ipcRenderer.invoke(IpcChannel.Providers_SyncModels, models),
  removeModel: (modelId) => ipcRenderer.invoke(IpcChannel.Providers_RemoveModel, modelId),
  saveConfiguration: (configuration) =>
    ipcRenderer.invoke(IpcChannel.Providers_SaveConfiguration, configuration),
  selectModel: (modelId) => ipcRenderer.invoke(IpcChannel.Providers_SelectModel, modelId),
  testModel: (model) => ipcRenderer.invoke(IpcChannel.Providers_TestModel, model)
}

const api = { appearance, chat, providers, windowControls }

export { api, type WindowApiType }

type WindowApiType = typeof api
