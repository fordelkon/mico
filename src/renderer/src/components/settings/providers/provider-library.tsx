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
  updateCustomProvider: (
    providerId: ProviderId,
    updates: Partial<Omit<CustomProvider, 'id'>>
  ) => void
}
type ProviderLibraryState = {
  isLoaded: boolean
  /** Copy shown when the initial catalog load fails; null once loaded. */
  loadError: string | null
  saveError: string | null
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
  updateCustomProvider: () => undefined
})
const ProviderLibraryStateContext = React.createContext<ProviderLibraryState>({
  isLoaded: false,
  loadError: null,
  saveError: null,
  library: toProviderCatalog(initialLibrary)
})
function ProviderLibraryProvider({ children }: React.PropsWithChildren): React.JSX.Element {
  const [library, setLibrary] = React.useState(initialLibrary)
  const [isLoaded, setIsLoaded] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const libraryRef = React.useRef(library)
  React.useEffect(() => {
    libraryRef.current = library
  }, [library])
  const isLibraryLoaded = React.useRef(false)

  const refreshRevision = React.useRef(0)
  const structuralQueue = React.useRef<Promise<unknown>>(Promise.resolve())
  const modelMutation = React.useRef<Promise<void> | null>(null)
  const hasUnreconciledModels = React.useRef(false)
  const modelReconciliation = React.useRef<Promise<void> | null>(null)
  const reconcileModels = React.useCallback(async (): Promise<void> => {
    if (!hasUnreconciledModels.current) return
    if (!modelReconciliation.current) {
      modelReconciliation.current = (async (): Promise<void> => {
        const next = await window.api.providers.getLibrary()
        // Model actions are serialized; only provider fields and provider
        // selection can change locally while this authoritative catalog loads.
        libraryRef.current = {
          ...libraryRef.current,
          models: next.models,
          selectedModelId: next.selectedModelId
        }
        setLibrary(libraryRef.current)
        hasUnreconciledModels.current = false
      })()
    }
    try {
      await modelReconciliation.current
    } finally {
      modelReconciliation.current = null
    }
  }, [])

  const autosave = useAutosaveQueue({
    delayMs: configurationSaveDelay,
    save: async (atRevision) => {
      if (!isLibraryLoaded.current) return false
      let saved: PersistedProviderLibrary
      try {
        // A failed catalog read leaves reconciliation pending for the next save.
        await modelMutation.current
        await reconcileModels()
        saved = await window.api.providers.saveLibrary(libraryRef.current)
        setSaveError(null)
      } catch (error) {
        setSaveError(
          'Could not save provider settings. Your edits are still here. Retry saving before closing Mico.'
        )
        throw error
      }
      if (autosave.revision() !== atRevision) return true
      // Local state is already the snapshot's source, so only main's
      // selection sanitization is absorbed back — never the whole snapshot.
      libraryRef.current = {
        ...libraryRef.current,
        selectedModelId: saved.selectedModelId,
        selectedProviderId: saved.selectedProviderId
      }
      setLibrary(libraryRef.current)
      return true
    }
  })

  const editLibrary = React.useCallback(
    (updater: (current: PersistedProviderLibrary) => PersistedProviderLibrary): void => {
      // Keep the ref in sync synchronously: a flush that lands before React
      // commits must save and absorb the latest edits, not the last commit.
      libraryRef.current = updater(libraryRef.current)
      setLibrary(libraryRef.current)
      autosave.schedule()
    },
    [autosave]
  )
  const commitProviderDrafts = React.useCallback(async (): Promise<void> => {
    await structuralQueue.current.catch(() => undefined)
    await reconcileModels()
    await autosave.settle()
  }, [autosave, reconcileModels])
  const mutateStructure = React.useCallback(
    <T,>(mutate: () => T | Promise<T>): Promise<T> => {
      const task = structuralQueue.current
        .catch(() => undefined)
        .then(async () => {
          await reconcileModels()
          await autosave.settle()
          return mutate()
        })
      // Reserve the queue before yielding so concurrent actions cannot pass
      // the same draft commit and then replace one another's catalog changes.
      structuralQueue.current = task
      return task
    },
    [autosave, reconcileModels]
  )
  const mutateModels = React.useCallback(
    async (mutate: () => Promise<void>): Promise<void> => {
      const task = (async (): Promise<void> => {
        await mutate()
        hasUnreconciledModels.current = true
        await reconcileModels()
      })()
      modelMutation.current = task
      try {
        await task
      } finally {
        modelMutation.current = null
      }
    },
    [reconcileModels]
  )
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
      void commitProviderDrafts().catch(() => undefined)
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
    (provider: Omit<CustomProvider, 'id'>) =>
      mutateStructure(() => {
        const customProvider = { ...provider, id: crypto.randomUUID() }
        editLibrary((current) => ({
          ...current,
          customProviders: [...current.customProviders, customProvider],
          enabledProviderIds: customProvider.enabled
            ? [...new Set([...current.enabledProviderIds, customProvider.id])]
            : current.enabledProviderIds
        }))
        return customProvider
      }),
    [mutateStructure, editLibrary]
  )
  const addModel = React.useCallback(
    (model: { displayName?: string; modelId: string; provider: ProviderId }) =>
      mutateStructure(() =>
        mutateModels(async () => {
          await window.api.providers.addModel(model)
        })
      ),
    [mutateStructure, mutateModels]
  )
  const syncModels = React.useCallback(
    (providerId: ProviderId, models: DiscoveredModel[]) =>
      mutateStructure(() =>
        mutateModels(() => window.api.providers.syncModels({ provider: providerId, models }))
      ),
    [mutateStructure, mutateModels]
  )
  const updateCustomProvider = React.useCallback(
    (providerId: ProviderId, updates: Partial<Omit<CustomProvider, 'id'>>) => {
      editLibrary((current) => {
        const customProviders = current.customProviders.map((item) =>
          item.id === providerId ? { ...item, ...updates } : item
        )
        const enabled = customProviders.find(({ id }) => id === providerId)?.enabled
        return {
          ...current,
          customProviders,
          enabledProviderIds: enabled
            ? [...new Set([...current.enabledProviderIds, providerId])]
            : current.enabledProviderIds.filter((id) => id !== providerId)
        }
      })
    },
    [editLibrary]
  )
  const toggleModel = React.useCallback(
    (model: CatalogModel, enabled: boolean) =>
      mutateStructure(() => {
        editLibrary((current) => ({
          ...current,
          models: current.models.map((item) => (item.id === model.id ? { ...item, enabled } : item))
        }))
      }),
    [mutateStructure, editLibrary]
  )
  const removeCustomProvider = React.useCallback(
    (providerId: ProviderId) =>
      mutateStructure(() => {
        // Selection cleanup is main's invariant: saveLibrary sanitizes a
        // selection this removal invalidated, and the saved snapshot refreshes
        // the local state.
        editLibrary((current) => ({
          ...current,
          customProviders: current.customProviders.filter((provider) => provider.id !== providerId),
          models: current.models.filter((model) => model.provider !== providerId)
        }))
      }),
    [mutateStructure, editLibrary]
  )
  const selectModel = React.useCallback(
    (modelId: string) =>
      mutateStructure(async () => {
        editLibrary((current) => ({ ...current, selectedModelId: modelId }))
        // Selecting a model is a committed action: the composer's send path
        // resolves the selection in main, so a debounced save would let a fast
        // send start a turn before the selection is persisted.
        await autosave.flush()
      }),
    [autosave, mutateStructure, editLibrary]
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
    () => ({ isLoaded, loadError, saveError, library: catalog }),
    [isLoaded, loadError, saveError, catalog]
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
  type CatalogModel,
  type ProviderCatalog,
  type ProviderConfiguration,
  ProviderLibraryProvider,
  useProviderLibraryActions,
  useProviderLibraryState
}
