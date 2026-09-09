import { BrowserWindow, ipcMain, type IpcMain, type IpcMainInvokeEvent } from 'electron'

import { ChatRequestIdSchema, ChatStartRequestSchema } from '@shared/data/schemas/chat'
import { AppearancePreferenceSchema } from '@shared/data/schemas/preference'
import { ThemePreferencesSchema } from '@shared/data/schemas/theme'
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
import type { ChatService } from './ai/chat-service'
import type { MainWindowService } from './services/main-window-service'
import type { PreferenceService } from './services/preference-service'
import type { ProviderService } from './services/provider-service'

type IpcMainRegistrar = Pick<IpcMain, 'handle'>
type IpcDependencies = {
  getWindow: typeof BrowserWindow.fromWebContents
  ipcMain: IpcMainRegistrar
}

interface IpcServices {
  chat: Pick<ChatService, 'abort' | 'abortAll' | 'getModelCapabilities' | 'start'>
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
}

function registerIpc(
  { chat, mainWindow, preference, provider }: IpcServices,
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

  dependencies.ipcMain.handle(IpcChannel.Chat_Start, (event, input) => {
    getCallingWindow(event)
    const result = ChatStartRequestSchema.safeParse(input)
    if (!result.success) throw new Error('Invalid chat request')

    const ownerId = String(event.sender.id)
    const senderFrame = event.senderFrame
    if (!destroyedSenderIds.has(event.sender.id)) {
      destroyedSenderIds.add(event.sender.id)
      event.sender.once('destroyed', () => {
        destroyedSenderIds.delete(event.sender.id)
        chat.abortAll(ownerId)
      })
    }

    chat.start({ ownerId, request: result.data }, (chatEvent) => {
      // A renderer crash can dispose its frame before the owning WebContents emits 'destroyed'.
      if (!senderFrame || event.sender.isDestroyed() || senderFrame.isDestroyed()) {
        chat.abortAll(ownerId)
        return
      }

      try {
        event.sender.send(IpcChannel.Chat_Event, chatEvent)
      } catch {
        chat.abortAll(ownerId)
      }
    })
  })
  dependencies.ipcMain.handle(IpcChannel.Chat_GetCapabilities, (event) => {
    getCallingWindow(event)
    return chat.getModelCapabilities()
  })
  dependencies.ipcMain.handle(IpcChannel.Chat_Abort, (event, input) => {
    getCallingWindow(event)
    const result = ChatRequestIdSchema.safeParse(input)
    if (!result.success) throw new Error('Invalid chat request')

    chat.abort({ ownerId: String(event.sender.id), requestId: result.data })
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
