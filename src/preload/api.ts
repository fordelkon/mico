import { ipcRenderer, type IpcRendererEvent } from 'electron'

import type { AppearanceAPI } from '@shared/ipc/schemas/appearance'
import type { AttachmentsAPI } from '@shared/ipc/schemas/attachments'
import type { ChatAPI } from '@shared/ipc/schemas/chat'
import type { ProvidersAPI } from '@shared/ipc/schemas/providers'
import type { SessionsAPI } from '@shared/ipc/schemas/sessions'
import type { WindowControlsAPI } from '@shared/ipc/schemas/window-controls'
import type { WorkspacesAPI } from '@shared/ipc/schemas/workspaces'
import { IpcChannel } from '@shared/IpcChannel'

const windowControls: WindowControlsAPI = {
  close: () => ipcRenderer.invoke(IpcChannel.WindowControls_Close),
  isFocused: () => ipcRenderer.invoke(IpcChannel.WindowControls_IsFocused),
  isFullScreen: () => ipcRenderer.invoke(IpcChannel.WindowControls_IsFullscreen),
  isMaximized: () => ipcRenderer.invoke(IpcChannel.WindowControls_IsMaximized),
  maximize: () => ipcRenderer.invoke(IpcChannel.WindowControls_Maximize),
  minimize: () => ipcRenderer.invoke(IpcChannel.WindowControls_Minimize),
  onFocusChange: (listener) => {
    const wrappedListener = (_event: IpcRendererEvent, isFocused: boolean): void => {
      listener(isFocused)
    }

    ipcRenderer.on(IpcChannel.WindowControls_FocusChanged, wrappedListener)
    return () => ipcRenderer.removeListener(IpcChannel.WindowControls_FocusChanged, wrappedListener)
  },
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
  onProviderDraftFlush: (listener) => {
    const wrappedListener = (): void => {
      // The main process keeps the window alive until this acknowledgement arrives.
      void listener().finally(() => ipcRenderer.send(IpcChannel.Providers_DraftFlushed))
    }

    ipcRenderer.on(IpcChannel.Providers_FlushDraft, wrappedListener)
    return () => ipcRenderer.removeListener(IpcChannel.Providers_FlushDraft, wrappedListener)
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
  setPreference: (preference) =>
    ipcRenderer.invoke(IpcChannel.Appearance_SetPreference, preference),
  getThemeState: () => ipcRenderer.invoke(IpcChannel.Appearance_GetThemeState),
  onThemeChange: (listener) => {
    const wrappedListener = (
      _event: IpcRendererEvent,
      theme: Parameters<typeof listener>[0]
    ): void => {
      listener(theme)
    }

    ipcRenderer.on(IpcChannel.Appearance_ThemeChanged, wrappedListener)
    return () => ipcRenderer.removeListener(IpcChannel.Appearance_ThemeChanged, wrappedListener)
  },
  setThemePreferences: (preferences) =>
    ipcRenderer.invoke(IpcChannel.Appearance_SetThemePreferences, preferences)
}

const attachments: AttachmentsAPI = {
  pickCodeDocuments: () => ipcRenderer.invoke(IpcChannel.Attachments_PickCodeDocuments)
}

const chat: ChatAPI = {
  abortTurn: (requestId) => ipcRenderer.invoke(IpcChannel.Chat_AbortTurn, requestId),
  getCapabilities: () => ipcRenderer.invoke(IpcChannel.Chat_GetCapabilities),
  onTurnEvent: (listener) => {
    const wrappedListener = (
      _event: IpcRendererEvent,
      turnEvent: Parameters<typeof listener>[0]
    ): void => {
      listener(turnEvent)
    }

    ipcRenderer.on(IpcChannel.Chat_TurnEvent, wrappedListener)
    return () => ipcRenderer.removeListener(IpcChannel.Chat_TurnEvent, wrappedListener)
  },
  startTurn: (request) => ipcRenderer.invoke(IpcChannel.Chat_StartTurn, request)
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
  selectProvider: (providerId) =>
    ipcRenderer.invoke(IpcChannel.Providers_SelectProvider, providerId),
  testModel: (model) => ipcRenderer.invoke(IpcChannel.Providers_TestModel, model)
}

const sessions: SessionsAPI = {
  create: (input) => ipcRenderer.invoke(IpcChannel.Sessions_Create, input),
  delete: (sessionId) => ipcRenderer.invoke(IpcChannel.Sessions_Delete, sessionId),
  list: () => ipcRenderer.invoke(IpcChannel.Sessions_List),
  load: (sessionId) => ipcRenderer.invoke(IpcChannel.Sessions_Load, sessionId),
  rename: (input) => ipcRenderer.invoke(IpcChannel.Sessions_Rename, input),
  setThinkingEffort: (input) => ipcRenderer.invoke(IpcChannel.Sessions_SetThinkingEffort, input),
  setModelEntry: (input) => ipcRenderer.invoke(IpcChannel.Sessions_SetModelEntry, input),
  onTitleUpdated: (listener) => {
    const wrappedListener = (
      _event: IpcRendererEvent,
      update: Parameters<typeof listener>[0]
    ): void => listener(update)

    ipcRenderer.on(IpcChannel.Sessions_TitleUpdated, wrappedListener)
    return () => ipcRenderer.removeListener(IpcChannel.Sessions_TitleUpdated, wrappedListener)
  }
}

const workspaces: WorkspacesAPI = {
  addFromDialog: () => ipcRenderer.invoke(IpcChannel.Workspaces_AddFromDialog),
  archive: (projectId) => ipcRenderer.invoke(IpcChannel.Workspaces_Archive, projectId),
  list: () => ipcRenderer.invoke(IpcChannel.Workspaces_List),
  rename: (input) => ipcRenderer.invoke(IpcChannel.Workspaces_Rename, input),
  reveal: (projectId) => ipcRenderer.invoke(IpcChannel.Workspaces_Reveal, projectId),
  setDefault: (projectId) => ipcRenderer.invoke(IpcChannel.Workspaces_SetDefault, projectId)
}

const api = { appearance, attachments, chat, providers, sessions, windowControls, workspaces }

export { api, type WindowApiType }

type WindowApiType = typeof api
