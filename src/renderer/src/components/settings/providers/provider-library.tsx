import type { CustomProvider } from '@shared/data/schemas/provider'
import type {
  AddCustomProviderRequest,
  UpdateCustomProviderRequest
} from '@shared/ipc/schemas/providers'
import * as React from 'react'

import type { ProviderId } from './providers-sidebar'

type ProviderConfiguration = {
  apiKey: string
  baseUrl: string
  enabled: boolean
}

type ProviderModel = {
  enabled: boolean
  id: string
  name: string
  providerId: ProviderId
}

type ProviderLibrary = {
  configurations: Record<ProviderId, ProviderConfiguration>
  customProviders: CustomProvider[]
  enabledProviderIds: ProviderId[]
  models: ProviderModel[]
  selectedModelId: string | null
}

type ProviderLibraryContextValue = {
  addCustomProvider: (provider: AddCustomProviderRequest) => Promise<CustomProvider>
  updateCustomProvider: (provider: UpdateCustomProviderRequest) => Promise<void>
  removeCustomProvider: (providerId: ProviderId) => Promise<void>
  library: ProviderLibrary
  selectModel: (modelId: string) => void
  setModels: (providerId: ProviderId, models: ProviderModel[]) => void
  updateConfiguration: (providerId: ProviderId, configuration: ProviderConfiguration) => void
}

const initialLibrary: ProviderLibrary = {
  configurations: {
    'lm-studio': { apiKey: '', baseUrl: 'http://localhost:1234', enabled: false },
    ollama: { apiKey: '', baseUrl: 'http://localhost:11434', enabled: false }
  },
  customProviders: [],
  enabledProviderIds: [],
  models: [],
  selectedModelId: null
}

function getCustomProviderConfigurations(
  customProviders: CustomProvider[]
): Record<ProviderId, ProviderConfiguration> {
  return Object.fromEntries(
    customProviders.map(({ id }) => [id, { apiKey: '', baseUrl: '', enabled: false }])
  )
}

const ProviderLibraryContext = React.createContext<ProviderLibraryContextValue>({
  addCustomProvider: async () => {
    throw new Error('Provider library is unavailable.')
  },
  updateCustomProvider: async () => {
    throw new Error('Provider library is unavailable.')
  },
  removeCustomProvider: async () => {
    throw new Error('Provider library is unavailable.')
  },
  library: initialLibrary,
  selectModel: () => undefined,
  setModels: () => undefined,
  updateConfiguration: () => undefined
})

function ProviderLibraryProvider({ children }: React.PropsWithChildren): React.JSX.Element {
  const [library, setLibrary] = React.useState(initialLibrary)

  React.useEffect(() => {
    let isActive = true

    void window.api.providers.getLibrary().then((nextLibrary) => {
      if (!isActive) return

      setLibrary((current) => ({
        ...current,
        customProviders: nextLibrary.customProviders,
        configurations: {
          ...current.configurations,
          ...getCustomProviderConfigurations(nextLibrary.customProviders)
        }
      }))
    })

    return () => {
      isActive = false
    }
  }, [])

  const updateConfiguration = React.useCallback(
    (providerId: ProviderId, configuration: ProviderConfiguration): void => {
      setLibrary((current) => {
        const wasEnabled = current.configurations[providerId].enabled
        const enabledProviderIds = configuration.enabled
          ? wasEnabled
            ? current.enabledProviderIds
            : [...current.enabledProviderIds, providerId]
          : wasEnabled
            ? current.enabledProviderIds.filter((id) => id !== providerId)
            : current.enabledProviderIds

        return {
          ...current,
          configurations: { ...current.configurations, [providerId]: configuration },
          enabledProviderIds
        }
      })
    },
    []
  )
  const addCustomProvider = React.useCallback(
    async (provider: AddCustomProviderRequest): Promise<CustomProvider> => {
      const nextLibrary = await window.api.providers.addCustomProvider(provider)
      const customProvider = nextLibrary.customProviders.at(-1)
      if (!customProvider) throw new Error('The custom provider was not returned after saving.')

      setLibrary((current) => ({
        ...current,
        customProviders: nextLibrary.customProviders,
        configurations: {
          ...current.configurations,
          ...getCustomProviderConfigurations(nextLibrary.customProviders)
        }
      }))
      return customProvider
    },
    []
  )
  const setModels = React.useCallback((providerId: ProviderId, models: ProviderModel[]): void => {
    setLibrary((current) => ({
      ...current,
      models: [...current.models.filter((model) => model.providerId !== providerId), ...models]
    }))
  }, [])
  const updateCustomProvider = React.useCallback(
    async (provider: UpdateCustomProviderRequest): Promise<void> => {
      const nextLibrary = await window.api.providers.updateCustomProvider(provider)

      setLibrary((current) => ({
        ...current,
        customProviders: nextLibrary.customProviders
      }))
    },
    []
  )
  const removeCustomProvider = React.useCallback(async (providerId: ProviderId): Promise<void> => {
    const nextLibrary = await window.api.providers.removeCustomProvider(providerId)

    setLibrary((current) => {
      const models = current.models.filter((model) => model.providerId !== providerId)
      const { [providerId]: _removedConfiguration, ...configurations } = current.configurations

      return {
        ...current,
        configurations,
        customProviders: nextLibrary.customProviders,
        enabledProviderIds: current.enabledProviderIds.filter((id) => id !== providerId),
        models,
        selectedModelId: models.some((model) => model.id === current.selectedModelId)
          ? current.selectedModelId
          : null
      }
    })
  }, [])
  const selectModel = React.useCallback((modelId: string): void => {
    setLibrary((current) => ({ ...current, selectedModelId: modelId }))
  }, [])
  const value = React.useMemo(
    () => ({
      addCustomProvider,
      library,
      removeCustomProvider,
      selectModel,
      setModels,
      updateCustomProvider,
      updateConfiguration
    }),
    [
      addCustomProvider,
      library,
      removeCustomProvider,
      selectModel,
      setModels,
      updateCustomProvider,
      updateConfiguration
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
