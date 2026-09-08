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
  selectedProviderId: string | null
}

function toPersistedLibrary(library: ProviderLibrary): PersistedProviderLibrary {
  const configurations: PersistedProviderLibrary['configurations'][number][] = []
  const lmStudio = library.configurations['lm-studio']
  if (lmStudio) {
    const configuration: Extract<
      PersistedProviderLibrary['configurations'][number],
      { provider: 'lm-studio' }
    > = {
      provider: 'lm-studio',
      baseUrl: lmStudio.baseUrl,
      enabled: lmStudio.enabled
    }
    if (lmStudio.apiKey) configuration.apiKey = lmStudio.apiKey
    configurations.push(configuration)
  }
  const ollama = library.configurations.ollama
  if (ollama)
    configurations.push({ provider: 'ollama', baseUrl: ollama.baseUrl, enabled: ollama.enabled })
  return {
    configurations,
    customProviders: library.customProviders,
    enabledProviderIds: library.enabledProviderIds,
    models: library.models.map(({ id, providerId, modelId, name, enabled }) => ({
      id,
      provider: providerId,
      modelId,
      displayName: name,
      enabled
    })),
    selectedModelId: library.selectedModelId,
    selectedProviderId: library.selectedProviderId
  }
}
type ProviderLibraryContextValue = {
  addCustomProvider: (provider: AddCustomProviderRequest) => Promise<CustomProvider>
  flushLibrary: () => Promise<void>
  isLoaded: boolean
  library: ProviderLibrary
  removeCustomProvider: (providerId: ProviderId) => Promise<void>
  selectModel: (modelId: string) => Promise<void>
  selectProvider: (providerId: ProviderId | null) => Promise<void>
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
  selectedModelId: null,
  selectedProviderId: null
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
    enabledProviderIds: next.enabledProviderIds ?? [
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
    selectedModelId: next.selectedModelId,
    selectedProviderId: next.selectedProviderId
  }
}
const unavailable = async (): Promise<never> => {
  throw new Error('Provider library is unavailable.')
}
const ProviderLibraryContext = React.createContext<ProviderLibraryContextValue>({
  addCustomProvider: unavailable,
  flushLibrary: async () => undefined,
  isLoaded: false,
  library: initialLibrary,
  removeCustomProvider: unavailable,
  selectModel: async () => undefined,
  selectProvider: async () => undefined,
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
  const configurationSaveRevisions = React.useRef(new Map<ProviderId, number>())
  const configurationSaveQueues = React.useRef(new Map<ProviderId, Promise<void>>())
  const pendingConfigurationSaves = React.useRef(new Map<ProviderId, Promise<void>>())
  const pendingConfigurations = React.useRef(new Map<ProviderId, ProviderConfiguration>())
  const libraryRef = React.useRef(library)
  const librarySaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  // A stale debounced snapshot must not finish after model sync and overwrite its normalized state.
  const librarySaveQueue = React.useRef(Promise.resolve())
  const isLibraryLoaded = React.useRef(false)
  const libraryRevision = React.useRef(0)
  const hasUnsavedLibraryChanges = React.useRef(false)
  React.useEffect(() => {
    libraryRef.current = library
  }, [library])

  const refreshRevision = React.useRef(0)
  const refresh = React.useCallback(async (): Promise<void> => {
    const revision = ++refreshRevision.current
    const next = await window.api.providers.getLibrary()
    if (revision === refreshRevision.current) setLibrary(fromPersistedLibrary(next))
  }, [])
  const commitLibrary = React.useCallback(async (): Promise<void> => {
    const revision = libraryRevision.current
    const library = toPersistedLibrary(libraryRef.current)
    const save = librarySaveQueue.current
      .catch(() => undefined)
      .then(async () => {
        const saved = await window.api.providers.saveLibrary(library)
        if (libraryRevision.current === revision) hasUnsavedLibraryChanges.current = false
        setLibrary(fromPersistedLibrary(saved))
      })
    librarySaveQueue.current = save
    await save
  }, [])
  const scheduleLibrarySave = React.useCallback((): void => {
    libraryRevision.current += 1
    hasUnsavedLibraryChanges.current = true
    if (librarySaveTimer.current) clearTimeout(librarySaveTimer.current)
    librarySaveTimer.current = setTimeout(() => void commitLibrary(), configurationSaveDelay)
  }, [commitLibrary])

  const persistConfiguration = React.useCallback(
    async (): Promise<void> => commitLibrary(),
    [commitLibrary]
  )
  const flushConfiguration = React.useCallback(
    (providerId: ProviderId) => {
      const timer = configurationSaveTimers.current.get(providerId)
      if (timer) clearTimeout(timer)
      configurationSaveTimers.current.delete(providerId)

      const configuration = pendingConfigurations.current.get(providerId)
      if (!configuration) return
      pendingConfigurations.current.delete(providerId)
      const revision = (configurationSaveRevisions.current.get(providerId) ?? 0) + 1
      configurationSaveRevisions.current.set(providerId, revision)
      const previousSave = configurationSaveQueues.current.get(providerId) ?? Promise.resolve()
      const save = previousSave
        .catch(() => undefined)
        .then(async () => {
          await persistConfiguration()
          if (configurationSaveRevisions.current.get(providerId) !== revision) return
          await refresh()
        })
        .catch(async (error) => {
          await refresh()
          throw error
        })
      configurationSaveQueues.current.set(providerId, save)
      pendingConfigurationSaves.current.set(providerId, save)
      void save
        .finally(() => {
          if (pendingConfigurationSaves.current.get(providerId) === save)
            pendingConfigurationSaves.current.delete(providerId)
        })
        .catch(() => undefined)
    },
    [persistConfiguration, refresh]
  )

  const waitForConfigurationSaves = React.useCallback(async (): Promise<void> => {
    for (const providerId of configurationSaveTimers.current.keys()) flushConfiguration(providerId)
    await Promise.all(pendingConfigurationSaves.current.values())
  }, [flushConfiguration])

  const flushLibrary = React.useCallback(async (): Promise<void> => {
    if (librarySaveTimer.current) clearTimeout(librarySaveTimer.current)
    await waitForConfigurationSaves()
    await librarySaveQueue.current
    if (!isLibraryLoaded.current || !hasUnsavedLibraryChanges.current) return

    // A flush always serializes the draft, never a refresh result, so rail reordering and persistence share one state transition.
    await commitLibrary()
  }, [commitLibrary, waitForConfigurationSaves])

  React.useEffect(
    () =>
      window.api.windowControls.onProviderDraftFlush(async () => {
        await flushLibrary()
      }),
    [flushLibrary]
  )

  React.useEffect(
    () => () => {
      for (const timer of configurationSaveTimers.current.values()) clearTimeout(timer)
      if (librarySaveTimer.current) clearTimeout(librarySaveTimer.current)
      // Strict Mode also runs cleanup during hydration; an unloaded or clean draft must never replace persisted data.
      void flushLibrary()
    },
    [flushLibrary]
  )
  React.useEffect(() => {
    let isActive = true
    void refresh().then(() => {
      if (!isActive) return
      isLibraryLoaded.current = true
      setIsLoaded(true)
    })
    return () => {
      isActive = false
    }
  }, [refresh])
  const updateConfiguration = React.useCallback(
    (
      providerId: ProviderId,
      configuration: ProviderConfiguration,
      { immediate = false }: { immediate?: boolean } = {}
    ) => {
      setLibrary((current) => ({
        ...current,
        configurations: { ...current.configurations, [providerId]: configuration },
        customProviders: current.customProviders.map((provider) =>
          provider.id === providerId ? { ...provider, enabled: configuration.enabled } : provider
        ),
        enabledProviderIds: configuration.enabled
          ? [...new Set([...current.enabledProviderIds, providerId])]
          : current.enabledProviderIds.filter((id) => id !== providerId)
      }))
      scheduleLibrarySave()
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
    [flushConfiguration, scheduleLibrarySave]
  )
  const addCustomProvider = React.useCallback(
    async (provider: AddCustomProviderRequest) => {
      await waitForConfigurationSaves()
      const customProvider = { ...provider, id: crypto.randomUUID() }
      setLibrary((current) => ({
        ...current,
        customProviders: [...current.customProviders, customProvider],
        configurations: {
          ...current.configurations,
          [customProvider.id]: {
            apiKey: customProvider.apiKey ?? '',
            baseUrl: customProvider.baseUrl,
            enabled: customProvider.enabled ?? false
          }
        }
      }))
      scheduleLibrarySave()
      return customProvider
    },
    [scheduleLibrarySave, waitForConfigurationSaves]
  )
  const syncModels = React.useCallback(
    async (providerId: ProviderId, models: DiscoveredModel[]) => {
      await flushLibrary()
      await window.api.providers.syncModels({ provider: providerId, models })
      await refresh()
    },
    [flushLibrary, refresh]
  )
  const updateCustomProvider = React.useCallback(
    async (provider: UpdateCustomProviderRequest) => {
      await waitForConfigurationSaves()
      setLibrary((current) => ({
        ...current,
        customProviders: current.customProviders.map((item) =>
          item.id === provider.id ? provider : item
        )
      }))
      scheduleLibrarySave()
    },
    [scheduleLibrarySave, waitForConfigurationSaves]
  )
  const toggleModel = React.useCallback(
    async (model: ProviderModel, enabled: boolean) => {
      await waitForConfigurationSaves()
      setLibrary((current) => ({
        ...current,
        models: current.models.map((item) => (item.id === model.id ? { ...item, enabled } : item))
      }))
      scheduleLibrarySave()
    },
    [scheduleLibrarySave, waitForConfigurationSaves]
  )
  const removeCustomProvider = React.useCallback(
    async (providerId: ProviderId) => {
      await waitForConfigurationSaves()
      setLibrary((current) => ({
        ...current,
        customProviders: current.customProviders.filter((provider) => provider.id !== providerId),
        models: current.models.filter((model) => model.providerId !== providerId),
        selectedProviderId:
          current.selectedProviderId === providerId ? null : current.selectedProviderId
      }))
      scheduleLibrarySave()
    },
    [scheduleLibrarySave, waitForConfigurationSaves]
  )
  const selectModel = React.useCallback(
    async (modelId: string) => {
      await waitForConfigurationSaves()
      setLibrary((current) => ({ ...current, selectedModelId: modelId }))
      scheduleLibrarySave()
    },
    [scheduleLibrarySave, waitForConfigurationSaves]
  )
  const selectProvider = React.useCallback(
    async (providerId: ProviderId | null) => {
      setLibrary((current) => ({ ...current, selectedProviderId: providerId }))
      await waitForConfigurationSaves()
      scheduleLibrarySave()
    },
    [scheduleLibrarySave, waitForConfigurationSaves]
  )
  const value = React.useMemo(
    () => ({
      addCustomProvider,
      flushLibrary,
      flushConfiguration,
      isLoaded,
      library,
      removeCustomProvider,
      selectModel,
      selectProvider,
      syncModels,
      toggleModel,
      updateConfiguration,
      updateCustomProvider
    }),
    [
      addCustomProvider,
      flushLibrary,
      flushConfiguration,
      isLoaded,
      library,
      removeCustomProvider,
      selectModel,
      selectProvider,
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
