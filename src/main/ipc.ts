import {
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMain,
  type IpcMainInvokeEvent
} from 'electron'
import { open, stat as statFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'

import { TurnRequestIdSchema, TurnStartRequestSchema } from '@shared/ipc/schemas/chat'
import {
  ChatDocumentPartSchema,
  CodeDocumentExtensions,
  CodeDocumentMaxNameLength,
  CodeDocumentMaxTextBytes,
  CodeDocumentsMaxTextBytes
} from '@shared/data/schemas/chat'
import type { ChatDocumentPart } from '@shared/data/schemas/chat'
import { AppearancePreferenceSchema } from '@shared/data/schemas/preference'
import { ThemePreferencesSchema } from '@shared/data/schemas/theme'
import { ProjectIdSchema, SessionIdSchema, SessionTitleSchema } from '@shared/data/schemas/session'
import { ThinkingSelectionSchema } from '@shared/data/schemas/chat'
import {
  CustomProviderSchema,
  CustomProviderIdSchema,
  ModelEntryIdSchema,
  ModelProviderSchema,
  ProviderConfigurationSchema,
  ProviderLibrarySchema
} from '@shared/data/schemas/provider'
import { IpcChannel } from '@shared/IpcChannel'
import {
  AddModelRequestSchema,
  ImportModelRequestSchema,
  SetModelEnabledRequestSchema,
  SyncModelsRequestSchema,
  TestModelRequestSchema
} from '@shared/ipc/schemas/providers'
import type { TurnExecutor } from './ai/chat/turn-executor'
import type { MainWindowService } from './services/main-window-service'
import type { PreferenceService } from './services/preference-service'
import type { ProviderService } from './ai/providers/provider-service'
import type { SessionRuntimeService } from './ai/sessions/session-runtime-service'
import type { WorkspaceService } from './ai/workspaces/workspace-service'

type IpcMainRegistrar = Pick<IpcMain, 'handle'>
type IpcFileHandle = Pick<Awaited<ReturnType<typeof open>>, 'close' | 'read'>
type IpcDependencies = {
  getWindow: typeof BrowserWindow.fromWebContents
  ipcMain: IpcMainRegistrar
  openPath: (fullPath: string) => Promise<string>
  pickDirectory: (window: BrowserWindow) => Promise<string | undefined>
  pickCodeDocuments: (window: BrowserWindow) => Promise<{ canceled: boolean; filePaths: string[] }>
  openFile: (filePath: string) => Promise<IpcFileHandle>
  stat: (filePath: string) => Promise<{ size: number }>
}

const maxDocumentReadBytes = CodeDocumentMaxTextBytes + 1

async function readBoundedFile(
  openFile: IpcDependencies['openFile'],
  filePath: string,
  maxBytes: number
): Promise<Uint8Array> {
  const handle = await openFile(filePath)
  try {
    const bytes = new Uint8Array(maxBytes)
    let totalBytesRead = 0
    while (totalBytesRead < maxBytes) {
      const { bytesRead } = await handle.read(
        bytes,
        totalBytesRead,
        maxBytes - totalBytesRead,
        totalBytesRead
      )
      if (bytesRead === 0) return bytes.subarray(0, totalBytesRead)
      totalBytesRead += bytesRead
    }
    return bytes
  } finally {
    await handle.close()
  }
}

interface IpcServices {
  turnExecutor: Pick<
    TurnExecutor,
    | 'abortAllTurns'
    | 'abortTurn'
    | 'getModelCapabilities'
    | 'startTurn'
    | 'updateSessionModelEntry'
    | 'updateSessionThinkingEffort'
  >
  mainWindow: Pick<
    MainWindowService,
    | 'close'
    | 'isFocused'
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
    | 'getAppearancePreference'
    | 'getResolvedAppearance'
    | 'getThemeState'
    | 'setAppearancePreference'
    | 'setThemePreferences'
  >
  provider: Pick<
    ProviderService,
    | 'addModel'
    | 'addCustomProvider'
    | 'updateCustomProvider'
    | 'discoverModels'
    | 'getLibrary'
    | 'importModel'
    | 'setModelEnabled'
    | 'syncModels'
    | 'removeModel'
    | 'removeCustomProvider'
    | 'saveConfiguration'
    | 'saveLibrary'
    | 'selectModel'
    | 'selectProvider'
    | 'testModel'
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
  dependencies.ipcMain.handle(IpcChannel.WindowControls_IsFocused, (event) =>
    mainWindow.isFocused(getCallingWindow(event))
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
  dependencies.ipcMain.handle(IpcChannel.Appearance_GetThemeState, (event) => {
    getCallingWindow(event)
    return preference.getThemeState()
  })
  dependencies.ipcMain.handle(IpcChannel.Appearance_SetThemePreferences, async (event, input) => {
    getCallingWindow(event)
    const result = ThemePreferencesSchema.safeParse(input)
    if (!result.success) throw new Error('Invalid theme preferences')

    return preference.setThemePreferences(result.data)
  })

  dependencies.ipcMain.handle(IpcChannel.Attachments_PickCodeDocuments, async (event) => {
    const window = getCallingWindow(event)
    let selection: { canceled: boolean; filePaths: string[] }
    try {
      selection = await dependencies.pickCodeDocuments(window)
    } catch {
      throw new Error('Unable to open the document picker. Please try again.')
    }
    if (selection.canceled) return []

    const documents: ChatDocumentPart[] = []
    let totalBytes = 0
    for (const filePath of selection.filePaths) {
      const name = basename(filePath)
      // SAFETY: `includes` compares an extension string against this readonly allowlist.
      if (
        !CodeDocumentExtensions.includes(extname(name) as (typeof CodeDocumentExtensions)[number])
      ) {
        throw new Error('Only code and text documents can be attached.')
      }
      if (name.length > CodeDocumentMaxNameLength) {
        throw new Error(`"${name}" is too long. Shorten or rename it and try again.`)
      }

      let fileSize: number
      try {
        fileSize = (await dependencies.stat(filePath)).size
      } catch {
        throw new Error(
          `Unable to inspect "${name}". Check that the file still exists and try again.`
        )
      }
      if (fileSize > CodeDocumentMaxTextBytes) {
        throw new Error(`"${name}" is larger than 256 KiB. Choose a smaller file and try again.`)
      }
      if (totalBytes + fileSize > CodeDocumentsMaxTextBytes) {
        throw new Error(
          'Selected documents exceed the 1 MiB total limit. Choose fewer or smaller files and try again.'
        )
      }

      let bytes: Uint8Array
      try {
        bytes = await readBoundedFile(dependencies.openFile, filePath, maxDocumentReadBytes)
      } catch {
        throw new Error(
          `Unable to read "${name}". Check that the file is accessible and try again.`
        )
      }
      if (bytes.byteLength > CodeDocumentMaxTextBytes) {
        throw new Error(`"${name}" is larger than 256 KiB. Choose a smaller file and try again.`)
      }
      if (totalBytes + bytes.byteLength > CodeDocumentsMaxTextBytes) {
        throw new Error(
          'Selected documents exceed the 1 MiB total limit. Choose fewer or smaller files and try again.'
        )
      }

      let text: string
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        throw new Error(
          `"${name}" is not valid UTF-8 text. Choose a UTF-8 encoded file and try again.`
        )
      }
      documents.push(ChatDocumentPartSchema.parse({ type: 'document', name, text }))
      totalBytes += bytes.byteLength
    }

    return documents
  })

  dependencies.ipcMain.handle(IpcChannel.Chat_StartTurn, (event, input) => {
    getCallingWindow(event)
    const result = TurnStartRequestSchema.safeParse(input)
    if (!result.success) throw new Error('Invalid turn request')

    const ownerId = String(event.sender.id)
    const senderFrame = event.senderFrame
    if (!destroyedSenderIds.has(event.sender.id)) {
      destroyedSenderIds.add(event.sender.id)
      event.sender.once('destroyed', () => {
        destroyedSenderIds.delete(event.sender.id)
        turnExecutor.abortAllTurns(ownerId)
      })
    }

    turnExecutor.startTurn(
      { ownerId, request: result.data },
      (turnEvent) => {
        // A renderer crash can dispose its frame before the owning WebContents emits 'destroyed'.
        if (!senderFrame || event.sender.isDestroyed() || senderFrame.isDestroyed()) {
          turnExecutor.abortAllTurns(ownerId)
          return
        }

        try {
          event.sender.send(IpcChannel.Chat_TurnEvent, turnEvent)
        } catch {
          turnExecutor.abortAllTurns(ownerId)
        }
      },
      (titleUpdate) => {
        if (!senderFrame || event.sender.isDestroyed() || senderFrame.isDestroyed()) return

        try {
          event.sender.send(IpcChannel.Sessions_TitleUpdated, titleUpdate)
        } catch {
          // A title update is auxiliary metadata; a failed delivery must not stop the chat.
        }
      }
    )
  })
  dependencies.ipcMain.handle(IpcChannel.Chat_GetCapabilities, (event) => {
    getCallingWindow(event)
    return turnExecutor.getModelCapabilities()
  })
  dependencies.ipcMain.handle(IpcChannel.Chat_AbortTurn, (event, input) => {
    getCallingWindow(event)
    const result = TurnRequestIdSchema.safeParse(input)
    if (!result.success) throw new Error('Invalid turn request')

    turnExecutor.abortTurn({ ownerId: String(event.sender.id), requestId: result.data })
  })

  dependencies.ipcMain.handle(IpcChannel.Sessions_List, (event) => {
    getCallingWindow(event)
    return session.listSessions()
  })
  dependencies.ipcMain.handle(IpcChannel.Sessions_Create, (event, input) => {
    getCallingWindow(event)
    const title = SessionTitleSchema.safeParse(input?.title)
    const projectId =
      input?.projectId === undefined ? undefined : ProjectIdSchema.safeParse(input.projectId)
    if (!title.success) throw new Error('Invalid session title')
    if (projectId !== undefined && !projectId.success) throw new Error('Invalid session project')

    const context = projectId?.success
      ? workspace.getActiveProjectContext(projectId.data)
      : workspace.getDefaultWorkspaceContext()

    return session.createSession({
      title: title.data,
      defaultProfile: null,
      projectId: context.projectId,
      cwd: context.rootPath
    })
  })
  dependencies.ipcMain.handle(IpcChannel.Sessions_Delete, (event, input) => {
    getCallingWindow(event)
    const result = SessionIdSchema.safeParse(input)
    if (!result.success) throw new Error('Invalid session ID')

    return session.deleteSession(result.data)
  })
  dependencies.ipcMain.handle(IpcChannel.Sessions_Load, (event, input) => {
    getCallingWindow(event)
    const result = SessionIdSchema.safeParse(input)
    if (!result.success) throw new Error('Invalid session ID')

    return session.loadSession(result.data)
  })
  dependencies.ipcMain.handle(IpcChannel.Sessions_Rename, (event, input) => {
    getCallingWindow(event)
    const sessionId = SessionIdSchema.safeParse(input?.sessionId)
    const title = SessionTitleSchema.safeParse(input?.title)
    if (!sessionId.success || !title.success) throw new Error('Invalid session rename')

    return session.renameSession(sessionId.data, title.data)
  })
  dependencies.ipcMain.handle(IpcChannel.Sessions_SetThinkingEffort, (event, input) => {
    getCallingWindow(event)
    const sessionId = SessionIdSchema.safeParse(input?.sessionId)
    const thinkingEffort = ThinkingSelectionSchema.safeParse(input?.thinkingEffort)
    if (!sessionId.success || !thinkingEffort.success)
      throw new Error('Invalid session thinking effort')
    turnExecutor.updateSessionThinkingEffort(sessionId.data, thinkingEffort.data)
  })
  dependencies.ipcMain.handle(IpcChannel.Sessions_SetModelEntry, (event, input) => {
    getCallingWindow(event)
    const sessionId = SessionIdSchema.safeParse(input?.sessionId)
    const modelEntryId = ModelEntryIdSchema.safeParse(input?.modelEntryId)
    if (!sessionId.success || !modelEntryId.success) throw new Error('Invalid session model')
    turnExecutor.updateSessionModelEntry(sessionId.data, modelEntryId.data)
  })

  dependencies.ipcMain.handle(IpcChannel.Workspaces_List, (event) => {
    getCallingWindow(event)
    return workspace.listProjects()
  })
  dependencies.ipcMain.handle(IpcChannel.Workspaces_AddFromDialog, async (event) => {
    const window = getCallingWindow(event)
    const directoryPath = await dependencies.pickDirectory(window)
    return directoryPath ? workspace.addProject(directoryPath) : undefined
  })
  dependencies.ipcMain.handle(IpcChannel.Workspaces_SetDefault, (event, input) => {
    getCallingWindow(event)
    const projectId = ProjectIdSchema.safeParse(input)
    if (!projectId.success) throw new Error('Invalid workspace project ID')
    return workspace.setDefaultProject(projectId.data)
  })
  dependencies.ipcMain.handle(IpcChannel.Workspaces_Rename, (event, input) => {
    getCallingWindow(event)
    const projectId = ProjectIdSchema.safeParse(input?.projectId)
    const name = SessionTitleSchema.safeParse(input?.name)
    if (!projectId.success || !name.success) throw new Error('Invalid workspace project rename')
    return workspace.renameProject(projectId.data, name.data)
  })
  dependencies.ipcMain.handle(IpcChannel.Workspaces_Reveal, async (event, input) => {
    getCallingWindow(event)
    const projectId = ProjectIdSchema.safeParse(input)
    if (!projectId.success) throw new Error('Invalid workspace project ID')
    const error = await dependencies.openPath(
      workspace.getActiveProjectContext(projectId.data).rootPath
    )
    if (error) throw new Error('Unable to open workspace folder')
  })
  dependencies.ipcMain.handle(IpcChannel.Workspaces_Archive, (event, input) => {
    getCallingWindow(event)
    const projectId = ProjectIdSchema.safeParse(input)
    if (!projectId.success) throw new Error('Invalid workspace project ID')
    return workspace.archiveProject(projectId.data)
  })

  dependencies.ipcMain.handle(IpcChannel.Providers_GetLibrary, (event) => {
    getCallingWindow(event)
    return provider.getLibrary()
  })
  dependencies.ipcMain.handle(IpcChannel.Providers_AddCustomProvider, (event, input) => {
    getCallingWindow(event)
    const result = CustomProviderSchema.omit({ id: true }).safeParse(input)
    if (!result.success) throw new Error('Invalid custom provider')

    return provider.addCustomProvider(result.data)
  })
  dependencies.ipcMain.handle(IpcChannel.Providers_UpdateCustomProvider, (event, input) => {
    getCallingWindow(event)
    const result = CustomProviderSchema.safeParse(input)
    if (!result.success) throw new Error('Invalid custom provider')

    return provider.updateCustomProvider(result.data)
  })
  dependencies.ipcMain.handle(IpcChannel.Providers_RemoveCustomProvider, (event, input) => {
    getCallingWindow(event)
    const result = CustomProviderIdSchema.safeParse(input)
    if (!result.success) throw new Error('Invalid custom provider ID')

    return provider.removeCustomProvider(result.data)
  })
  dependencies.ipcMain.handle(IpcChannel.Providers_SaveConfiguration, (event, input) => {
    getCallingWindow(event)
    const result = ProviderConfigurationSchema.safeParse(input)
    if (!result.success) throw new Error('Invalid provider configuration')

    return provider.saveConfiguration(result.data)
  })
  dependencies.ipcMain.handle(IpcChannel.Providers_SaveLibrary, (event, input) => {
    getCallingWindow(event)
    const result = ProviderLibrarySchema.safeParse(input)
    if (!result.success) throw new Error('Invalid provider library')

    return provider.saveLibrary(result.data)
  })
  dependencies.ipcMain.handle(IpcChannel.Providers_DiscoverModels, (event, input) => {
    getCallingWindow(event)
    const result = ProviderConfigurationSchema.safeParse(input)
    if (!result.success) throw new Error('Invalid provider configuration')

    return provider.discoverModels(result.data)
  })
  dependencies.ipcMain.handle(IpcChannel.Providers_ImportModel, (event, input) => {
    getCallingWindow(event)
    const result = ImportModelRequestSchema.safeParse(input)
    if (!result.success) throw new Error('Invalid provider model')

    return provider.importModel(result.data)
  })
  dependencies.ipcMain.handle(IpcChannel.Providers_SetModelEnabled, (event, input) => {
    getCallingWindow(event)
    const result = SetModelEnabledRequestSchema.safeParse(input)
    if (!result.success) throw new Error('Invalid provider model')

    return provider.setModelEnabled(result.data)
  })
  dependencies.ipcMain.handle(IpcChannel.Providers_SyncModels, (event, input) => {
    getCallingWindow(event)
    const result = SyncModelsRequestSchema.safeParse(input)
    if (!result.success) throw new Error('Invalid provider models')

    return provider.syncModels(result.data)
  })
  dependencies.ipcMain.handle(IpcChannel.Providers_AddModel, (event, input) => {
    getCallingWindow(event)
    const result = AddModelRequestSchema.safeParse(input)
    if (!result.success) throw new Error('Invalid provider model')

    return provider.addModel(result.data)
  })
  dependencies.ipcMain.handle(IpcChannel.Providers_RemoveModel, (event, input) => {
    getCallingWindow(event)
    const result = ModelEntryIdSchema.safeParse(input)
    if (!result.success) throw new Error('Invalid provider model ID')

    return provider.removeModel(result.data)
  })
  dependencies.ipcMain.handle(IpcChannel.Providers_SelectModel, (event, input) => {
    getCallingWindow(event)
    const result = ModelEntryIdSchema.nullable().safeParse(input)
    if (!result.success) throw new Error('Invalid provider model ID')

    return provider.selectModel(result.data)
  })
  dependencies.ipcMain.handle(IpcChannel.Providers_SelectProvider, (event, input) => {
    getCallingWindow(event)
    const result = ModelProviderSchema.nullable().safeParse(input)
    if (!result.success) throw new Error('Invalid provider ID')

    return provider.selectProvider(result.data)
  })
  dependencies.ipcMain.handle(IpcChannel.Providers_TestModel, (event, input) => {
    getCallingWindow(event)
    const result = TestModelRequestSchema.safeParse(input)
    if (!result.success) throw new Error('Invalid provider model test')

    return provider.testModel(result.data)
  })
}

export { registerIpc }
