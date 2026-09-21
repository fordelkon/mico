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
type CatalogModel = {
  enabled: boolean
  id: string
  modelId: string
  name: string
  providerId: ProviderId
}
type ProviderCatalog = {
  configurations: Record<ProviderId, ProviderConfiguration>
  customProviders: CustomProvider[]
  enabledProviderIds: ProviderId[]
  enabledModelIds: string[]
  models: CatalogModel[]
  selectedModelId: string | null
  selectedProviderId: string | null
}

function toPersistedLibrary(library: ProviderCatalog): PersistedProviderLibrary {
  const configurations: PersistedProviderLibrary['configurations'][number][] = []
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
type ProviderLibraryActions = {
  addCustomProvider: (provider: AddCustomProviderRequest) => Promise<CustomProvider>
  addModel: (model: {
    displayName?: string
    modelId: string
    provider: ProviderId
  }) => Promise<void>
  commitProviderDrafts: () => Promise<void>
  removeCustomProvider: (providerId: ProviderId) => Promise<void>
  selectModel: (modelId: string) => Promise<void>
  selectProvider: (providerId: ProviderId | null) => Promise<void>
  syncModels: (providerId: ProviderId, models: DiscoveredModel[]) => Promise<void>
  toggleModel: (model: CatalogModel, enabled: boolean) => Promise<void>
  flushConfiguration: (providerId: ProviderId) => void
  updateConfiguration: (
    providerId: ProviderId,
    configuration: ProviderConfiguration,
    options?: { immediate?: boolean }
  ) => void
  updateCustomProvider: (provider: UpdateCustomProviderRequest) => Promise<void>
}
type ProviderLibraryState = {
  isLoaded: boolean
  /** Copy shown when the initial catalog load fails; null once loaded. */
  loadError: string | null
  library: ProviderCatalog
}

const configurationSaveDelay = 150
const initialLibrary: ProviderCatalog = {
  configurations: {
    ollama: { apiKey: '', baseUrl: 'http://localhost:11434', enabled: false }
  },
  customProviders: [],
  enabledProviderIds: [],
  enabledModelIds: [],
  models: [],
  selectedModelId: null,
  selectedProviderId: null
}
function fromPersistedLibrary(next: PersistedProviderLibrary): ProviderCatalog {
  const configurations = { ...initialLibrary.configurations }
  for (const configuration of next.configurations) {
    if (configuration.provider === 'ollama') {
      configurations[configuration.provider] = {
        apiKey: '',
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
const ProviderLibraryActionsContext = React.createContext<ProviderLibraryActions>({
  addCustomProvider: unavailable,
  addModel: async () => undefined,
  commitProviderDrafts: async () => undefined,
  removeCustomProvider: unavailable,
  selectModel: async () => undefined,
  selectProvider: async () => undefined,
  syncModels: unavailable,
  toggleModel: unavailable,
  flushConfiguration: () => undefined,
  updateConfiguration: () => undefined,
  updateCustomProvider: unavailable
})
const ProviderLibraryStateContext = React.createContext<ProviderLibraryState>({
  isLoaded: false,
  loadError: null,
  library: initialLibrary
})
function ProviderLibraryProvider({ children }: React.PropsWithChildren): React.JSX.Element {
  const [library, setLibrary] = React.useState(initialLibrary)
  const [isLoaded, setIsLoaded] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
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
    try {
      const next = await window.api.providers.getLibrary()
      if (revision === refreshRevision.current) {
        setLibrary(fromPersistedLibrary(next))
        setIsLoaded(true)
      }
    } catch {
      if (revision === refreshRevision.current)
        setLoadError('Could not load models. Open Settings and try again.')
    }
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

  const commitProviderDrafts = React.useCallback(async (): Promise<void> => {
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
        await commitProviderDrafts()
      }),
    [commitProviderDrafts]
  )

  React.useEffect(
    () => () => {
      for (const timer of configurationSaveTimers.current.values()) clearTimeout(timer)
      if (librarySaveTimer.current) clearTimeout(librarySaveTimer.current)
      // Strict Mode also runs cleanup during hydration; an unloaded or clean draft must never replace persisted data.
      void commitProviderDrafts()
    },
    [commitProviderDrafts]
  )
  React.useEffect(() => {
    let isActive = true
    void (async (): Promise<void> => {
      const revision = ++refreshRevision.current
      try {
        const next = await window.api.providers.getLibrary()
        if (!isActive || revision !== refreshRevision.current) return
        setLibrary(fromPersistedLibrary(next))
        isLibraryLoaded.current = true
        setIsLoaded(true)
      } catch {
        if (isActive && revision === refreshRevision.current)
          setLoadError('Could not load models. Open Settings and try again.')
      }
    })()
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
  const addModel = React.useCallback(
    async (model: { displayName?: string; modelId: string; provider: ProviderId }) => {
      await commitProviderDrafts()
      await window.api.providers.addModel(model)
      await refresh()
    },
    [commitProviderDrafts, refresh]
  )
  const syncModels = React.useCallback(
    async (providerId: ProviderId, models: DiscoveredModel[]) => {
      await commitProviderDrafts()
      await window.api.providers.syncModels({ provider: providerId, models })
      await refresh()
    },
    [commitProviderDrafts, refresh]
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
    async (model: CatalogModel, enabled: boolean) => {
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
  const actions = React.useMemo(
    () => ({
      addCustomProvider,
      addModel,
      commitProviderDrafts,
      flushConfiguration,
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
      addModel,
      commitProviderDrafts,
      flushConfiguration,
      removeCustomProvider,
      selectModel,
      selectProvider,
      syncModels,
      toggleModel,
      updateConfiguration,
      updateCustomProvider
    ]
  )
  const state = React.useMemo(
    () => ({ isLoaded, loadError, library }),
    [isLoaded, loadError, library]
  )
  return (
    <ProviderLibraryActionsContext value={actions}>
      <ProviderLibraryStateContext value={state}>{children}</ProviderLibraryStateContext>
    </ProviderLibraryActionsContext>
  )
}
function useProviderLibraryActions(): ProviderLibraryActions {
  return React.useContext(ProviderLibraryActionsContext)
}
function useProviderLibraryState(): ProviderLibraryState {
  return React.useContext(ProviderLibraryStateContext)
}

export {
  type ProviderConfiguration,
  type ProviderCatalog,
  ProviderLibraryProvider,
  type CatalogModel,
  useProviderLibraryActions,
  useProviderLibraryState
}
