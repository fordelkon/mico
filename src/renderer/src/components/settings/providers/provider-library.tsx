import type {
  CustomProvider,
  ProviderLibrary as PersistedProviderLibrary
} from '@shared/data/schemas/provider'
import type { DiscoveredModel } from '@shared/ipc/schemas/providers'
import * as React from 'react'

import type { ProviderId } from './providers-sidebar'
import { useAutosaveQueue } from './use-autosave-queue'

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
type ProviderLibraryActions = {
  addCustomProvider: (provider: Omit<CustomProvider, 'id'>) => Promise<CustomProvider>
  addModel: (model: {
    displayName?: string
    modelId: string
    provider: ProviderId
  }) => Promise<void>
  commitProviderDrafts: () => Promise<void>
  flushLibrary: () => Promise<void>
  removeCustomProvider: (providerId: ProviderId) => Promise<void>
  selectModel: (modelId: string) => Promise<void>
  selectProvider: (providerId: ProviderId | null) => Promise<void>
  syncModels: (providerId: ProviderId, models: DiscoveredModel[]) => Promise<void>
  toggleModel: (model: CatalogModel, enabled: boolean) => Promise<void>
  updateConfiguration: (providerId: ProviderId, configuration: ProviderConfiguration) => void
  updateCustomProvider: (provider: CustomProvider) => Promise<void>
}
type ProviderLibraryState = {
  isLoaded: boolean
  /** Copy shown when the initial catalog load fails; null once loaded. */
  loadError: string | null
  library: ProviderCatalog
}

const configurationSaveDelay = 150
const initialLibrary: PersistedProviderLibrary = {
  configurations: [{ provider: 'ollama', baseUrl: 'http://localhost:11434', enabled: false }],
  customProviders: [],
  enabledProviderIds: [],
  models: [],
  selectedModelId: null,
  selectedProviderId: null
}
/**
 * The one derivation from the persisted shape to the catalog view the UI
 * consumes. Mutations happen on the persisted state, so the catalog can never
 * drift into a shape that saveLibrary would not accept back.
 */
function toProviderCatalog(next: PersistedProviderLibrary): ProviderCatalog {
  const builtinOllama = next.configurations.find(({ provider }) => provider === 'ollama')
  const configurations: ProviderCatalog['configurations'] = {
    ollama: {
      apiKey: '',
      baseUrl: builtinOllama?.baseUrl ?? 'http://localhost:11434',
      enabled: builtinOllama?.enabled ?? false
    }
  }
  for (const provider of next.customProviders) {
    configurations[provider.id] = {
      apiKey: provider.apiKey ?? '',
      baseUrl: provider.baseUrl,
      enabled: provider.enabled ?? false
    }
  }
  return {
    configurations,
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
    selectedModelId: next.selectedModelId ?? null,
    selectedProviderId: next.selectedProviderId ?? null
  }
}
const unavailable = async (): Promise<never> => {
  throw new Error('Provider library is unavailable.')
}
const ProviderLibraryActionsContext = React.createContext<ProviderLibraryActions>({
  addCustomProvider: unavailable,
  addModel: async () => undefined,
  commitProviderDrafts: async () => undefined,
  flushLibrary: async () => undefined,
  removeCustomProvider: unavailable,
  selectModel: async () => undefined,
  selectProvider: async () => undefined,
  syncModels: unavailable,
  toggleModel: unavailable,
  updateConfiguration: () => undefined,
  updateCustomProvider: unavailable
})
const ProviderLibraryStateContext = React.createContext<ProviderLibraryState>({
  isLoaded: false,
  loadError: null,
  library: toProviderCatalog(initialLibrary)
})
function ProviderLibraryProvider({ children }: React.PropsWithChildren): React.JSX.Element {
  const [library, setLibrary] = React.useState(initialLibrary)
  const [isLoaded, setIsLoaded] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const libraryRef = React.useRef(library)
  React.useEffect(() => {
    libraryRef.current = library
  }, [library])
  const isLibraryLoaded = React.useRef(false)

  const refreshRevision = React.useRef(0)
  const refresh = React.useCallback(async (): Promise<void> => {
    const revision = ++refreshRevision.current
    try {
      const next = await window.api.providers.getLibrary()
      if (revision === refreshRevision.current) {
        setLibrary(next)
        setIsLoaded(true)
      }
    } catch {
      if (revision === refreshRevision.current)
        setLoadError('Could not load models. Open Settings and try again.')
    }
  }, [])

  const autosave = useAutosaveQueue({
    delayMs: configurationSaveDelay,
    save: async () => {
      if (!isLibraryLoaded.current) return false
      const snapshot = libraryRef.current
      const saved = await window.api.providers.saveLibrary(snapshot)
      // Local state is already the snapshot's source, so only main's
      // selection sanitization is absorbed back — never the whole snapshot.
      setLibrary((current) => ({
        ...current,
        selectedModelId: saved.selectedModelId,
        selectedProviderId: saved.selectedProviderId
      }))
      return true
    }
  })

  const editLibrary = React.useCallback(
    (updater: (current: PersistedProviderLibrary) => PersistedProviderLibrary): void => {
      setLibrary(updater)
      autosave.schedule()
    },
    [autosave]
  )
  const commitProviderDrafts = React.useCallback(async (): Promise<void> => {
    await autosave.settle()
  }, [autosave])
  const flushLibrary = React.useCallback(async (): Promise<void> => {
    await autosave.flush()
  }, [autosave])

  React.useEffect(
    () =>
      window.api.windowControls.onProviderDraftFlush(async () => {
        await commitProviderDrafts()
      }),
    [commitProviderDrafts]
  )

  React.useEffect(
    () => () => {
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
        setLibrary(next)
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
    (providerId: ProviderId, configuration: ProviderConfiguration): void => {
      editLibrary((current) => ({
        ...current,
        configurations: current.configurations.map((entry) =>
          entry.provider === providerId
            ? { ...entry, baseUrl: configuration.baseUrl, enabled: configuration.enabled }
            : entry
        ),
        customProviders: current.customProviders.map((provider) =>
          provider.id === providerId
            ? { ...provider, baseUrl: configuration.baseUrl, enabled: configuration.enabled }
            : provider
        ),
        enabledProviderIds: configuration.enabled
          ? [...new Set([...current.enabledProviderIds, providerId])]
          : current.enabledProviderIds.filter((id) => id !== providerId)
      }))
    },
    [editLibrary]
  )
  const addCustomProvider = React.useCallback(
    async (provider: Omit<CustomProvider, 'id'>) => {
      await commitProviderDrafts()
      const customProvider = { ...provider, id: crypto.randomUUID() }
      editLibrary((current) => ({
        ...current,
        customProviders: [...current.customProviders, customProvider],
        enabledProviderIds: customProvider.enabled
          ? [...new Set([...current.enabledProviderIds, customProvider.id])]
          : current.enabledProviderIds
      }))
      return customProvider
    },
    [commitProviderDrafts, editLibrary]
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
    async (provider: CustomProvider) => {
      await commitProviderDrafts()
      editLibrary((current) => ({
        ...current,
        customProviders: current.customProviders.map((item) =>
          item.id === provider.id ? provider : item
        ),
        enabledProviderIds: provider.enabled
          ? [...new Set([...current.enabledProviderIds, provider.id])]
          : current.enabledProviderIds.filter((id) => id !== provider.id)
      }))
    },
    [commitProviderDrafts, editLibrary]
  )
  const toggleModel = React.useCallback(
    async (model: CatalogModel, enabled: boolean) => {
      await commitProviderDrafts()
      editLibrary((current) => ({
        ...current,
        models: current.models.map((item) => (item.id === model.id ? { ...item, enabled } : item))
      }))
    },
    [commitProviderDrafts, editLibrary]
  )
  const removeCustomProvider = React.useCallback(
    async (providerId: ProviderId) => {
      await commitProviderDrafts()
      // Selection cleanup is main's invariant: saveLibrary sanitizes a
      // selection this removal invalidated, and the saved snapshot refreshes
      // the local state.
      editLibrary((current) => ({
        ...current,
        customProviders: current.customProviders.filter((provider) => provider.id !== providerId),
        models: current.models.filter((model) => model.provider !== providerId)
      }))
    },
    [commitProviderDrafts, editLibrary]
  )
  const selectModel = React.useCallback(
    async (modelId: string) => {
      await commitProviderDrafts()
      editLibrary((current) => ({ ...current, selectedModelId: modelId }))
    },
    [commitProviderDrafts, editLibrary]
  )
  const selectProvider = React.useCallback(
    async (providerId: ProviderId | null) => {
      editLibrary((current) => ({ ...current, selectedProviderId: providerId }))
      await commitProviderDrafts()
    },
    [commitProviderDrafts, editLibrary]
  )
  const catalog = React.useMemo(() => toProviderCatalog(library), [library])
  const actions = React.useMemo(
    () => ({
      addCustomProvider,
      addModel,
      commitProviderDrafts,
      flushLibrary,
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
      flushLibrary,
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
    () => ({ isLoaded, loadError, library: catalog }),
    [isLoaded, loadError, catalog]
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
