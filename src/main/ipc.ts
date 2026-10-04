import {
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMain,
  type IpcMainInvokeEvent
} from 'electron'
import { open, stat as statFile } from 'node:fs/promises'
import type { InvokeChannel } from '@shared/ipc/contracts'

import { IpcChannel } from '@shared/IpcChannel'
import {
  pickCodeDocuments,
  type CodeDocumentPickerDependencies
} from './attachments/code-document-picker'
import { TurnSenderGate } from './ai/chat/turn-sender-gate'
import type { TurnExecutor } from './ai/chat/turn-executor'
import type { SessionModelProfile } from './ai/chat/session-model-profile'
import { registerChannel, type ChannelDefinition } from './ipc/define-channel'
import type { MainWindowService } from './services/main-window-service'
import type { PreferenceService } from './services/preference-service'
import type { ProviderService } from './ai/providers/provider-service'
import type { SessionRuntimeService } from './ai/sessions/session-runtime-service'
import type { WorkspaceService } from './ai/workspaces/workspace-service'

type IpcMainRegistrar = Pick<IpcMain, 'handle'>
type IpcDependencies = CodeDocumentPickerDependencies & {
  getWindow: typeof BrowserWindow.fromWebContents
  ipcMain: IpcMainRegistrar
  openPath: (fullPath: string) => Promise<string>
  pickDirectory: (window: BrowserWindow) => Promise<string | undefined>
}

interface IpcServices {
  turnExecutor: Pick<
    TurnExecutor,
    'abortAllTurns' | 'abortTurn' | 'startTurn' | 'respondToPermission'
  >
  modelProfile: Pick<
    SessionModelProfile,
    'getCapabilities' | 'updateSessionModelEntry' | 'updateSessionThinkingEffort'
  >
  mainWindow: Pick<MainWindowService, 'isTrustedRendererUrl'>
  preference: Pick<
    PreferenceService,
    'getThemeState' | 'setAppearancePreference' | 'setThemePreferences'
  >
  provider: Pick<
    ProviderService,
    'addModel' | 'discoverModels' | 'getLibrary' | 'saveLibrary' | 'syncModels' | 'testModel'
  >
  session: Pick<
    SessionRuntimeService,
    'createSession' | 'deleteSession' | 'listSessions' | 'loadSession' | 'renameSession'
  >
  workspace: Pick<
    WorkspaceService,
    | 'addProject'
    | 'archiveProject'
    | 'getActiveProjectContext'
    | 'getDefaultWorkspaceContext'
    | 'getProjectContext'
    | 'listProjects'
    | 'renameProject'
    | 'setDefaultProject'
  >
}

function registerIpc(
  { turnExecutor, modelProfile, mainWindow, preference, provider, session, workspace }: IpcServices,
  dependencies: IpcDependencies = {
    getWindow: (webContents) => BrowserWindow.fromWebContents(webContents),
    ipcMain,
    openPath: (fullPath) => shell.openPath(fullPath),
    pickDirectory: async (window) => {
      const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
      return result.canceled ? undefined : result.filePaths[0]
    },
    pickCodeDocuments: (window) =>
      dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'] }),
    openFile: (filePath) => open(filePath, 'r'),
    stat: statFile
  }
): void {
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
  const senderGate = new TurnSenderGate()
  const register = <C extends InvokeChannel>(definition: ChannelDefinition<C>): void =>
    registerChannel(dependencies.ipcMain, getCallingWindow, definition)

  register({
    channel: IpcChannel.WindowControls_Close,
    handle: (_input, { window }) => window.close()
  })
  register({
    channel: IpcChannel.WindowControls_IsFocused,
    handle: (_input, { window }) => window.isFocused()
  })
  register({
    channel: IpcChannel.WindowControls_IsFullscreen,
    handle: (_input, { window }) => window.isFullScreen()
  })
  register({
    channel: IpcChannel.WindowControls_IsMaximized,
    handle: (_input, { window }) => window.isMaximized()
  })
  register({
    channel: IpcChannel.WindowControls_Maximize,
    handle: (_input, { window }) => window.maximize()
  })
  register({
    channel: IpcChannel.WindowControls_Minimize,
    handle: (_input, { window }) => window.minimize()
  })
  register({
    channel: IpcChannel.WindowControls_ToggleFullscreen,
    handle: (_input, { window }) => window.setFullScreen(!window.isFullScreen())
  })
  register({
    channel: IpcChannel.WindowControls_Unmaximize,
    handle: (_input, { window }) => window.unmaximize()
  })

  register({
    channel: IpcChannel.Appearance_SetPreference,
    invalidMessage: 'Invalid appearance preference',
    handle: (input) => preference.setAppearancePreference(input)
  })
  register({
    channel: IpcChannel.Appearance_GetThemeState,
    handle: () => preference.getThemeState()
  })
  register({
    channel: IpcChannel.Appearance_SetThemePreferences,
    invalidMessage: 'Invalid theme preferences',
    handle: (input) => preference.setThemePreferences(input)
  })

  register({
    channel: IpcChannel.Attachments_PickCodeDocuments,
    handle: (_input, { window }) => pickCodeDocuments(window, dependencies)
  })

  register({
    channel: IpcChannel.Chat_StartTurn,
    invalidMessage: 'Invalid turn request',
    handle: (request, { event }) => {
      const ownerId = String(event.sender.id)
      const { emitTurnEvent, emitTitleUpdate } = senderGate.connect(event, (owner) =>
        turnExecutor.abortAllTurns(owner)
      )
      turnExecutor.startTurn({ ownerId, request }, emitTurnEvent, emitTitleUpdate)
    }
  })
  register({
    channel: IpcChannel.Chat_GetCapabilities,
    handle: (sessionId) => modelProfile.getCapabilities(sessionId)
  })
  register({
    channel: IpcChannel.Chat_RespondToPermission,
    invalidMessage: 'Invalid tool approval response',
    handle: (response, { event }) =>
      turnExecutor.respondToPermission(String(event.sender.id), response)
  })
  register({
    channel: IpcChannel.Chat_AbortTurn,
    invalidMessage: 'Invalid turn request',
    handle: (requestId, { event }) =>
      turnExecutor.abortTurn({ ownerId: String(event.sender.id), requestId })
  })

  register({
    channel: IpcChannel.Sessions_List,
    handle: () => session.listSessions()
  })
  register({
    channel: IpcChannel.Sessions_Create,
    invalidMessage: 'Invalid session request',
    handle: ({ title, projectId }) => {
      const context = projectId
        ? workspace.getActiveProjectContext(projectId)
        : workspace.getDefaultWorkspaceContext()

      return session.createSession({
        title,
        defaultProfile: null,
        projectId: context.projectId,
        cwd: context.rootPath
      })
    }
  })
  register({
    channel: IpcChannel.Sessions_Delete,
    invalidMessage: 'Invalid session ID',
    handle: (sessionId) => session.deleteSession(sessionId)
  })
  register({
    channel: IpcChannel.Sessions_Load,
    invalidMessage: 'Invalid session ID',
    handle: (sessionId) => session.loadSession(sessionId)
  })
  register({
    channel: IpcChannel.Sessions_Rename,
    invalidMessage: 'Invalid session rename',
    handle: ({ sessionId, title }) => session.renameSession(sessionId, title)
  })
  register({
    channel: IpcChannel.Sessions_SetThinkingEffort,
    invalidMessage: 'Invalid session thinking effort',
    handle: ({ sessionId, thinkingEffort }) =>
      modelProfile.updateSessionThinkingEffort(sessionId, thinkingEffort)
  })
  register({
    channel: IpcChannel.Sessions_SetModelEntry,
    invalidMessage: 'Invalid session model',
    handle: ({ sessionId, modelEntryId }) =>
      modelProfile.updateSessionModelEntry(sessionId, modelEntryId)
  })

  register({
    channel: IpcChannel.Workspaces_List,
    handle: () => workspace.listProjects()
  })
  register({
    channel: IpcChannel.Workspaces_AddFromDialog,
    handle: (_input, { window }) =>
      dependencies
        .pickDirectory(window)
        .then((directoryPath) => (directoryPath ? workspace.addProject(directoryPath) : undefined))
  })
  register({
    channel: IpcChannel.Workspaces_SetDefault,
    invalidMessage: 'Invalid workspace project ID',
    handle: (projectId) => workspace.setDefaultProject(projectId)
  })
  register({
    channel: IpcChannel.Workspaces_Rename,
    invalidMessage: 'Invalid workspace project rename',
    handle: ({ projectId, name }) => workspace.renameProject(projectId, name)
  })
  register({
    channel: IpcChannel.Workspaces_Reveal,
    invalidMessage: 'Invalid workspace project ID',
    handle: async (projectId) => {
      const error = await dependencies.openPath(
        workspace.getActiveProjectContext(projectId).rootPath
      )
      if (error) throw new Error('Unable to open workspace folder')
    }
  })
  register({
    channel: IpcChannel.Workspaces_Archive,
    invalidMessage: 'Invalid workspace project ID',
    handle: (projectId) => workspace.archiveProject(projectId)
  })

  register({
    channel: IpcChannel.Providers_GetLibrary,
    handle: () => provider.getLibrary()
  })
  register({
    channel: IpcChannel.Providers_SaveLibrary,
    invalidMessage: 'Invalid provider library',
    handle: (library) => provider.saveLibrary(library)
  })
  register({
    channel: IpcChannel.Providers_DiscoverModels,
    invalidMessage: 'Invalid provider configuration',
    handle: (configuration) => provider.discoverModels(configuration)
  })
  register({
    channel: IpcChannel.Providers_SyncModels,
    invalidMessage: 'Invalid provider models',
    handle: (request) => provider.syncModels(request)
  })
  register({
    channel: IpcChannel.Providers_AddModel,
    invalidMessage: 'Invalid provider model',
    handle: (request) => provider.addModel(request)
  })
  register({
    channel: IpcChannel.Providers_TestModel,
    invalidMessage: 'Invalid provider model test',
    handle: (request) => provider.testModel(request)
  })
}

export { registerIpc }
