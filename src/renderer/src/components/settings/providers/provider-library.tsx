import type {
  CustomProvider,
  ProviderLibrary as PersistedProviderLibrary
} from '@shared/data/schemas/provider'
import type {
  AddCustomProviderRequest,
  DiscoveredModel,
  UpdateCustomProviderRequest
} from '@shared/ipc/schemas/providers'
import * as React from 'react'

import type { ProviderId } from './providers-sidebar'

type ProviderConfiguration = { apiKey: string; baseUrl: string; enabled: boolean }
type ProviderModel = {
  enabled: boolean
  id: string
  modelId: string
  name: string
  providerId: ProviderId
}
type ProviderLibrary = {
  configurations: Record<ProviderId, ProviderConfiguration>
  customProviders: CustomProvider[]
  enabledProviderIds: ProviderId[]
  enabledModelIds: string[]
  models: ProviderModel[]
  selectedModelId: string | null
}
type ProviderLibraryContextValue = {
  addCustomProvider: (provider: AddCustomProviderRequest) => Promise<CustomProvider>
  isLoaded: boolean
  library: ProviderLibrary
  removeCustomProvider: (providerId: ProviderId) => Promise<void>
  selectModel: (modelId: string) => Promise<void>
  syncModels: (providerId: ProviderId, models: DiscoveredModel[]) => Promise<void>
  toggleModel: (model: ProviderModel, enabled: boolean) => Promise<void>
  flushConfiguration: (providerId: ProviderId) => void
  updateConfiguration: (
    providerId: ProviderId,
    configuration: ProviderConfiguration,
    options?: { immediate?: boolean }
  ) => void
  updateCustomProvider: (provider: UpdateCustomProviderRequest) => Promise<void>
}

const configurationSaveDelay = 150
const initialLibrary: ProviderLibrary = {
  configurations: {
    'lm-studio': { apiKey: '', baseUrl: 'http://localhost:1234', enabled: false },
    ollama: { apiKey: '', baseUrl: 'http://localhost:11434', enabled: false }
  },
  customProviders: [],
  enabledProviderIds: [],
  enabledModelIds: [],
  models: [],
  selectedModelId: null
}
function fromPersistedLibrary(next: PersistedProviderLibrary): ProviderLibrary {
  const configurations = { ...initialLibrary.configurations }
  for (const configuration of next.configurations) {
    if (configuration.provider === 'lm-studio' || configuration.provider === 'ollama') {
      configurations[configuration.provider] = {
        apiKey: 'apiKey' in configuration ? (configuration.apiKey ?? '') : '',
        baseUrl: configuration.baseUrl,
        enabled: configuration.enabled ?? false
      }
    }
  }
  return {
    configurations: {
      ...configurations,
      ...Object.fromEntries(
        next.customProviders.map(({ id }) => [
          id,
          {
            apiKey: '',
            baseUrl: '',
            enabled: next.customProviders.find((provider) => provider.id === id)?.enabled ?? false
          }
        ])
      )
    },
    customProviders: next.customProviders,
    enabledProviderIds: [
      ...next.configurations.filter(({ enabled }) => enabled).map(({ provider }) => provider),
      ...next.customProviders.filter(({ enabled }) => enabled).map(({ id }) => id)
    ],
    models: next.models.map(({ displayName, enabled, id, modelId, provider }) => ({
      enabled,
      id,
      modelId,
      name: displayName || modelId,
      providerId: provider
    })),
    enabledModelIds: next.models.filter(({ enabled }) => enabled).map(({ id }) => id),
    selectedModelId: next.selectedModelId
  }
}
const unavailable = async (): Promise<never> => {
  throw new Error('Provider library is unavailable.')
}
const ProviderLibraryContext = React.createContext<ProviderLibraryContextValue>({
  addCustomProvider: unavailable,
  isLoaded: false,
  library: initialLibrary,
  removeCustomProvider: unavailable,
  selectModel: async () => undefined,
  syncModels: unavailable,
  toggleModel: unavailable,
  flushConfiguration: () => undefined,
  updateConfiguration: () => undefined,
  updateCustomProvider: unavailable
})
function ProviderLibraryProvider({ children }: React.PropsWithChildren): React.JSX.Element {
  const [library, setLibrary] = React.useState(initialLibrary)
  const [isLoaded, setIsLoaded] = React.useState(false)
  const configurationSaveTimers = React.useRef(new Map<ProviderId, ReturnType<typeof setTimeout>>())
  const pendingConfigurations = React.useRef(new Map<ProviderId, ProviderConfiguration>())
  const customProviders = React.useRef(library.customProviders)

  React.useEffect(() => {
    customProviders.current = library.customProviders
  }, [library.customProviders])

  const persistConfiguration = React.useCallback(
    (providerId: ProviderId, configuration: ProviderConfiguration) => {
      if (providerId === 'lm-studio') {
        void window.api.providers.saveConfiguration(
          configuration.apiKey.trim()
            ? {
                provider: 'lm-studio',
                baseUrl: configuration.baseUrl,
                apiKey: configuration.apiKey.trim(),
                enabled: configuration.enabled
              }
            : {
                provider: 'lm-studio',
                baseUrl: configuration.baseUrl,
                enabled: configuration.enabled
              }
        )
        return
      }
      if (providerId === 'ollama') {
        void window.api.providers.saveConfiguration({
          provider: 'ollama',
          baseUrl: configuration.baseUrl,
          enabled: configuration.enabled
        })
        return
      }
      const customProvider = customProviders.current.find(({ id }) => id === providerId)
      if (customProvider) {
        void window.api.providers.updateCustomProvider({
          ...customProvider,
          enabled: configuration.enabled
        })
      }
    },
    []
  )
  const flushConfiguration = React.useCallback(
    (providerId: ProviderId) => {
      const timer = configurationSaveTimers.current.get(providerId)
      if (timer) clearTimeout(timer)
      configurationSaveTimers.current.delete(providerId)

      const configuration = pendingConfigurations.current.get(providerId)
      if (!configuration) return
      pendingConfigurations.current.delete(providerId)
      persistConfiguration(providerId, configuration)
    },
    [persistConfiguration]
  )

  React.useEffect(
    () => () => {
      for (const timer of configurationSaveTimers.current.values()) clearTimeout(timer)
    },
    []
  )
  React.useEffect(() => {
    let isActive = true
    void window.api.providers.getLibrary().then((next) => {
      if (!isActive) return
      setLibrary(fromPersistedLibrary(next))
      setIsLoaded(true)
    })
    return () => {
      isActive = false
    }
  }, [])
  const updateConfiguration = React.useCallback(
    (
      providerId: ProviderId,
      configuration: ProviderConfiguration,
      { immediate = false }: { immediate?: boolean } = {}
    ) => {
      setLibrary((current) => ({
        ...current,
        configurations: { ...current.configurations, [providerId]: configuration },
        enabledProviderIds: configuration.enabled
          ? [...new Set([...current.enabledProviderIds, providerId])]
          : current.enabledProviderIds.filter((id) => id !== providerId)
      }))
      pendingConfigurations.current.set(providerId, configuration)
      if (immediate) {
        flushConfiguration(providerId)
        return
      }

      const timer = configurationSaveTimers.current.get(providerId)
      if (timer) clearTimeout(timer)
      configurationSaveTimers.current.set(
        providerId,
        setTimeout(() => flushConfiguration(providerId), configurationSaveDelay)
      )
    },
    [flushConfiguration]
  )
  const addCustomProvider = React.useCallback(async (provider: AddCustomProviderRequest) => {
    const nextLibrary = await window.api.providers.addCustomProvider(provider)
    const customProvider = nextLibrary.customProviders.at(-1)
    if (!customProvider) throw new Error('The custom provider was not returned after saving.')
    setLibrary(fromPersistedLibrary(nextLibrary))
    return customProvider
  }, [])
  const syncModels = React.useCallback(
    async (providerId: ProviderId, models: DiscoveredModel[]) => {
      const nextLibrary = await window.api.providers.syncModels({ provider: providerId, models })
      setLibrary(fromPersistedLibrary(nextLibrary))
    },
    []
  )
  const updateCustomProvider = React.useCallback(async (provider: UpdateCustomProviderRequest) => {
    const nextLibrary = await window.api.providers.updateCustomProvider(provider)
    setLibrary(fromPersistedLibrary(nextLibrary))
  }, [])
  const toggleModel = React.useCallback(async (model: ProviderModel, enabled: boolean) => {
    const nextLibrary = await window.api.providers.setModelEnabled({ modelId: model.id, enabled })
    setLibrary(fromPersistedLibrary(nextLibrary))
  }, [])
  const removeCustomProvider = React.useCallback(async (providerId: ProviderId) => {
    const nextLibrary = await window.api.providers.removeCustomProvider(providerId)
    setLibrary(fromPersistedLibrary(nextLibrary))
  }, [])
  const selectModel = React.useCallback(async (modelId: string) => {
    const nextLibrary = await window.api.providers.selectModel(modelId)
    setLibrary(fromPersistedLibrary(nextLibrary))
  }, [])
  const value = React.useMemo(
    () => ({
      addCustomProvider,
      flushConfiguration,
      isLoaded,
      library,
      removeCustomProvider,
      selectModel,
      syncModels,
      toggleModel,
      updateConfiguration,
      updateCustomProvider
    }),
    [
      addCustomProvider,
      flushConfiguration,
      isLoaded,
      library,
      removeCustomProvider,
      selectModel,
      syncModels,
      toggleModel,
      updateConfiguration,
      updateCustomProvider
    ]
  )
  return <ProviderLibraryContext value={value}>{children}</ProviderLibraryContext>
}
function useProviderLibrary(): ProviderLibraryContextValue {
  return React.useContext(ProviderLibraryContext)
}
export {
  ProviderLibraryProvider,
  useProviderLibrary,
  type ProviderConfiguration,
  type ProviderLibrary,
  type ProviderModel
}
