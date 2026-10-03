import {
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMain,
  type IpcMainInvokeEvent
} from 'electron'
import { open, stat as statFile } from 'node:fs/promises'
import * as z from 'zod'

import { TurnRequestIdSchema, TurnStartRequestSchema } from '@shared/ipc/schemas/chat'
import { PermissionResponseSchema } from '@shared/ai/permissions'
import { AppearancePreferenceSchema } from '@shared/data/schemas/preference'
import { ThemePreferencesSchema } from '@shared/data/schemas/theme'
import { ProjectIdSchema, SessionIdSchema, SessionTitleSchema } from '@shared/data/schemas/session'
import { ThinkingSelectionSchema } from '@shared/data/schemas/chat'
import {
  ModelEntryIdSchema,
  ProviderConfigurationSchema,
  ProviderLibrarySchema
} from '@shared/data/schemas/provider'
import { IpcChannel } from '@shared/IpcChannel'
import {
  AddModelRequestSchema,
  SyncModelsRequestSchema,
  TestModelRequestSchema
} from '@shared/ipc/schemas/providers'
import {
  pickCodeDocuments,
  type CodeDocumentPickerDependencies
} from './attachments/code-document-picker'
import { CreateSessionRequestSchema } from '@shared/ipc/schemas/sessions'
import { TurnSenderGate } from './ai/chat/turn-sender-gate'
import type { TurnExecutor } from './ai/chat/turn-executor'
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
    | 'abortAllTurns'
    | 'abortTurn'
    | 'getModelCapabilities'
    | 'startTurn'
    | 'respondToPermission'
    | 'updateSessionModelEntry'
    | 'updateSessionThinkingEffort'
  >
  mainWindow: Pick<MainWindowService, 'isTrustedRendererUrl'>
  preference: Pick<
    PreferenceService,
    | 'getAppearancePreference'
    | 'getResolvedAppearance'
    | 'getThemeState'
    | 'setAppearancePreference'
    | 'setThemePreferences'
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
  { turnExecutor, mainWindow, preference, provider, session, workspace }: IpcServices,
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
  const register = <I, O>(definition: ChannelDefinition<I, O>): void =>
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
    channel: IpcChannel.Appearance_GetPreference,
    handle: () => preference.getAppearancePreference()
  })
  register({
    channel: IpcChannel.Appearance_GetResolved,
    handle: () => preference.getResolvedAppearance()
  })
  register({
    channel: IpcChannel.Appearance_SetPreference,
    input: { schema: AppearancePreferenceSchema, invalidMessage: 'Invalid appearance preference' },
    handle: (input) => preference.setAppearancePreference(input)
  })
  register({
    channel: IpcChannel.Appearance_GetThemeState,
    handle: () => preference.getThemeState()
  })
  register({
    channel: IpcChannel.Appearance_SetThemePreferences,
    input: { schema: ThemePreferencesSchema, invalidMessage: 'Invalid theme preferences' },
    handle: (input) => preference.setThemePreferences(input)
  })

  register({
    channel: IpcChannel.Attachments_PickCodeDocuments,
    handle: (_input, { window }) => pickCodeDocuments(window, dependencies)
  })

  register({
    channel: IpcChannel.Chat_StartTurn,
    input: { schema: TurnStartRequestSchema, invalidMessage: 'Invalid turn request' },
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
    handle: () => turnExecutor.getModelCapabilities()
  })
  register({
    channel: IpcChannel.Chat_RespondToPermission,
    input: { schema: PermissionResponseSchema, invalidMessage: 'Invalid tool approval response' },
    handle: (response, { event }) =>
      turnExecutor.respondToPermission(String(event.sender.id), response)
  })
  register({
    channel: IpcChannel.Chat_AbortTurn,
    input: { schema: TurnRequestIdSchema, invalidMessage: 'Invalid turn request' },
    handle: (requestId, { event }) =>
      turnExecutor.abortTurn({ ownerId: String(event.sender.id), requestId })
  })

  register({
    channel: IpcChannel.Sessions_List,
    handle: () => session.listSessions()
  })
  register({
    channel: IpcChannel.Sessions_Create,
    input: { schema: CreateSessionRequestSchema, invalidMessage: 'Invalid session request' },
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
    input: { schema: SessionIdSchema, invalidMessage: 'Invalid session ID' },
    handle: (sessionId) => session.deleteSession(sessionId)
  })
  register({
    channel: IpcChannel.Sessions_Load,
    input: { schema: SessionIdSchema, invalidMessage: 'Invalid session ID' },
    handle: (sessionId) => session.loadSession(sessionId)
  })
  register({
    channel: IpcChannel.Sessions_Rename,
    input: {
      schema: z.object({ sessionId: SessionIdSchema, title: SessionTitleSchema }),
      invalidMessage: 'Invalid session rename'
    },
    handle: ({ sessionId, title }) => session.renameSession(sessionId, title)
  })
  register({
    channel: IpcChannel.Sessions_SetThinkingEffort,
    input: {
      schema: z.object({ sessionId: SessionIdSchema, thinkingEffort: ThinkingSelectionSchema }),
      invalidMessage: 'Invalid session thinking effort'
    },
    handle: ({ sessionId, thinkingEffort }) =>
      turnExecutor.updateSessionThinkingEffort(sessionId, thinkingEffort)
  })
  register({
    channel: IpcChannel.Sessions_SetModelEntry,
    input: {
      schema: z.object({ sessionId: SessionIdSchema, modelEntryId: ModelEntryIdSchema }),
      invalidMessage: 'Invalid session model'
    },
    handle: ({ sessionId, modelEntryId }) =>
      turnExecutor.updateSessionModelEntry(sessionId, modelEntryId)
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
    input: { schema: ProjectIdSchema, invalidMessage: 'Invalid workspace project ID' },
    handle: (projectId) => workspace.setDefaultProject(projectId)
  })
  register({
    channel: IpcChannel.Workspaces_Rename,
    input: {
      schema: z.object({ projectId: ProjectIdSchema, name: SessionTitleSchema }),
      invalidMessage: 'Invalid workspace project rename'
    },
    handle: ({ projectId, name }) => workspace.renameProject(projectId, name)
  })
  register({
    channel: IpcChannel.Workspaces_Reveal,
    input: { schema: ProjectIdSchema, invalidMessage: 'Invalid workspace project ID' },
    handle: async (projectId) => {
      const error = await dependencies.openPath(
        workspace.getActiveProjectContext(projectId).rootPath
      )
      if (error) throw new Error('Unable to open workspace folder')
    }
  })
  register({
    channel: IpcChannel.Workspaces_Archive,
    input: { schema: ProjectIdSchema, invalidMessage: 'Invalid workspace project ID' },
    handle: (projectId) => workspace.archiveProject(projectId)
  })

  register({
    channel: IpcChannel.Providers_GetLibrary,
    handle: () => provider.getLibrary()
  })
  register({
    channel: IpcChannel.Providers_SaveLibrary,
    input: { schema: ProviderLibrarySchema, invalidMessage: 'Invalid provider library' },
    handle: (library) => provider.saveLibrary(library)
  })
  register({
    channel: IpcChannel.Providers_DiscoverModels,
    input: {
      schema: ProviderConfigurationSchema,
      invalidMessage: 'Invalid provider configuration'
    },
    handle: (configuration) => provider.discoverModels(configuration)
  })
  register({
    channel: IpcChannel.Providers_SyncModels,
    input: { schema: SyncModelsRequestSchema, invalidMessage: 'Invalid provider models' },
    handle: (request) => provider.syncModels(request)
  })
  register({
    channel: IpcChannel.Providers_AddModel,
    input: { schema: AddModelRequestSchema, invalidMessage: 'Invalid provider model' },
    handle: (request) => provider.addModel(request)
  })
  register({
    channel: IpcChannel.Providers_TestModel,
    input: { schema: TestModelRequestSchema, invalidMessage: 'Invalid provider model test' },
    handle: (request) => provider.testModel(request)
  })
}

export { registerIpc }
