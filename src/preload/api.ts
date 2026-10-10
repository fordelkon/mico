import './validation-runtime'
import { IpcChannel } from '@shared/IpcChannel'
import {
  type InvokeChannel,
  type IpcArgs,
  type IpcOutput,
  outputSchema
} from '@shared/ipc/contracts'
import type { AppearanceAPI } from '@shared/ipc/schemas/appearance'
import type { AttachmentsAPI } from '@shared/ipc/schemas/attachments'
import type { ChatAPI } from '@shared/ipc/schemas/chat'
import type { ProvidersAPI } from '@shared/ipc/schemas/providers'
import type { SessionsAPI } from '@shared/ipc/schemas/sessions'
import type { SkillsAPI } from '@shared/ipc/schemas/skills'
import type { WindowControlsAPI } from '@shared/ipc/schemas/window-controls'
import type { WorkspacesAPI } from '@shared/ipc/schemas/workspaces'
import { type IpcRendererEvent, ipcRenderer } from 'electron'
import * as z from 'zod'

async function invoke<C extends InvokeChannel>(
  channel: C,
  ...args: IpcArgs<C>
): Promise<IpcOutput<C>> {
  const result: unknown = await ipcRenderer.invoke(channel, ...args)
  return z.parse(outputSchema(channel), result)
}

const windowControls: WindowControlsAPI = {
  platform:
    process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux',
  close: () => invoke(IpcChannel.WindowControls_Close),
  isFocused: () => invoke(IpcChannel.WindowControls_IsFocused),
  isFullScreen: () => invoke(IpcChannel.WindowControls_IsFullscreen),
  isMaximized: () => invoke(IpcChannel.WindowControls_IsMaximized),
  maximize: () => invoke(IpcChannel.WindowControls_Maximize),
  minimize: () => invoke(IpcChannel.WindowControls_Minimize),
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
  toggleFullScreen: () => invoke(IpcChannel.WindowControls_ToggleFullscreen),
  unmaximize: () => invoke(IpcChannel.WindowControls_Unmaximize)
}

const appearance: AppearanceAPI = {
  setPreference: (preference) => invoke(IpcChannel.Appearance_SetPreference, preference),
  getThemeState: () => invoke(IpcChannel.Appearance_GetThemeState),
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
    invoke(IpcChannel.Appearance_SetThemePreferences, preferences)
}

const attachments: AttachmentsAPI = {
  pickCodeDocuments: () => invoke(IpcChannel.Attachments_PickCodeDocuments)
}

const chat: ChatAPI = {
  respondToPermission: (response) => invoke(IpcChannel.Chat_RespondToPermission, response),
  abortTurn: (requestId) => invoke(IpcChannel.Chat_AbortTurn, requestId),
  getCapabilities: (sessionId) => invoke(IpcChannel.Chat_GetCapabilities, sessionId),
  getSkillCatalog: (request) => invoke(IpcChannel.Chat_GetSkillCatalog, request),
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
  startTurn: (request) => invoke(IpcChannel.Chat_StartTurn, request)
}

const providers: ProvidersAPI = {
  addModel: (model) => invoke(IpcChannel.Providers_AddModel, model),
  discoverModels: (configuration) => invoke(IpcChannel.Providers_DiscoverModels, configuration),
  getLibrary: () => invoke(IpcChannel.Providers_GetLibrary),
  saveLibrary: (library) => invoke(IpcChannel.Providers_SaveLibrary, library),
  syncModels: (models) => invoke(IpcChannel.Providers_SyncModels, models),
  testModel: (model) => invoke(IpcChannel.Providers_TestModel, model)
}

const sessions: SessionsAPI = {
  create: (input) => invoke(IpcChannel.Sessions_Create, input),
  delete: (sessionId) => invoke(IpcChannel.Sessions_Delete, sessionId),
  list: () => invoke(IpcChannel.Sessions_List),
  load: (sessionId) => invoke(IpcChannel.Sessions_Load, sessionId),
  rename: (input) => invoke(IpcChannel.Sessions_Rename, input),
  setThinkingEffort: (input) => invoke(IpcChannel.Sessions_SetThinkingEffort, input),
  setModelEntry: (input) => invoke(IpcChannel.Sessions_SetModelEntry, input),
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
  addFromDialog: () => invoke(IpcChannel.Workspaces_AddFromDialog),
  archive: (projectId) => invoke(IpcChannel.Workspaces_Archive, projectId),
  list: () => invoke(IpcChannel.Workspaces_List),
  rename: (input) => invoke(IpcChannel.Workspaces_Rename, input),
  reveal: (projectId) => invoke(IpcChannel.Workspaces_Reveal, projectId),
  setDefault: (projectId) => invoke(IpcChannel.Workspaces_SetDefault, projectId)
}

const skills: SkillsAPI = {
  list: (request) => invoke(IpcChannel.Skills_List, request),
  readDocument: (request) => invoke(IpcChannel.Skills_ReadDocument, request)
}

const api = {
  appearance,
  attachments,
  chat,
  providers,
  sessions,
  skills,
  windowControls,
  workspaces
}

export { api, type WindowApiType }

type WindowApiType = typeof api
