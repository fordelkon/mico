import { Button, Input, InputGroup, InputGroupAddon, InputGroupInput, Toggle } from '@mico/ui'
import { useListReorderAnimation } from '@renderer/hooks/use-list-reorder-animation'
import { sortByEnabledOrder } from '@renderer/utils/enabled-order'
import type { ProviderConfiguration } from '@shared/data/schemas/provider'
import type { AddModelRequest } from '@shared/ipc/schemas/providers'
import { DownloadIcon, PlusIcon, SearchIcon } from 'lucide-react'
import * as React from 'react'

import { useProviderLibraryActions, useProviderLibraryState } from './provider-library'
import type { ProviderId } from './providers-sidebar'

type ProviderStatus = { kind: 'error' | 'success'; message: string } | null

function ProviderModelsSection({
  isCustomProvider,
  onModelsFetched,
  onFetchStart,
  onStatusChange,
  providerConfiguration,
  providerId,
  providerLabel
}: {
  isCustomProvider: boolean
  onFetchStart: () => void
  onModelsFetched: () => void
  onStatusChange: (status: ProviderStatus) => void
  providerConfiguration: ProviderConfiguration
  providerId: ProviderId
  providerLabel: string
}): React.JSX.Element {
  const { addModel, syncModels, toggleModel } = useProviderLibraryActions()
  const { library } = useProviderLibraryState()
  const [hasFetchedModels, setHasFetchedModels] = React.useState(false)
  const [isFetchingModels, setIsFetchingModels] = React.useState(false)
  const [modelsSearch, setModelsSearch] = React.useState('')
  const [modelId, setModelId] = React.useState('')
  const [displayName, setDisplayName] = React.useState('')
  const [isAddingModel, setIsAddingModel] = React.useState(false)
  const modelReorderAnimation = useListReorderAnimation()
  const models = library.models.filter((model) => model.providerId === providerId)
  const hasModels = hasFetchedModels || models.length > 0
  const filteredModels = models.filter((model) =>
    model.name.toLowerCase().includes(modelsSearch.toLowerCase())
  )

  const fetchModels = async (): Promise<void> => {
    setIsFetchingModels(true)
    onFetchStart()

    try {
      const discoveredModels = await window.api.providers.discoverModels(providerConfiguration)
      await syncModels(providerId, discoveredModels)
      setHasFetchedModels(true)
      onModelsFetched()
    } catch (error) {
      onStatusChange({
        kind: 'error',
        message: error instanceof Error ? error.message : 'The provider returned an unknown error.'
      })
    } finally {
      setIsFetchingModels(false)
    }
  }

  const addManualModel = async (): Promise<void> => {
    const trimmedModelId = modelId.trim()
    if (!trimmedModelId) return

    setIsAddingModel(true)
    onFetchStart()
    try {
      const manualModel: AddModelRequest = {
        provider: providerId,
        modelId: trimmedModelId
      }
      if (displayName.trim()) manualModel.displayName = displayName.trim()
      await addModel(manualModel)
      setModelId('')
      setDisplayName('')
      setHasFetchedModels(true)
      onModelsFetched()
    } catch (error) {
      onStatusChange({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Unable to add the model.'
      })
    } finally {
      setIsAddingModel(false)
    }
  }

  return (
    <section aria-labelledby="models-heading" className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium" id="models-heading">
            Models
          </h3>
        </div>
        <Button
          aria-label={`Fetch ${providerLabel} models`}
          disabled={isFetchingModels || isAddingModel}
          onClick={() => void fetchModels()}
          size="sm"
          variant="outline"
        >
          <DownloadIcon aria-hidden="true" />
          {isFetchingModels ? 'Fetching' : 'Fetch'}
        </Button>
      </div>
      {isCustomProvider ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void addManualModel()
          }}
        >
          <Input
            aria-label={`Model ID for ${providerLabel}`}
            disabled={isFetchingModels || isAddingModel}
            onChange={(event) => setModelId(event.target.value)}
            placeholder="Model ID (e.g. gpt-4o)"
            value={modelId}
          />
          <Input
            aria-label={`Display name for ${providerLabel}`}
            disabled={isFetchingModels || isAddingModel}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Display Name (optional)"
            value={displayName}
          />
          <Button
            aria-label={`Add ${providerLabel} model`}
            disabled={isFetchingModels || isAddingModel || !modelId.trim()}
            size="sm"
            type="submit"
            variant="outline"
          >
            <PlusIcon aria-hidden="true" />
            Add
          </Button>
        </form>
      ) : null}
      <InputGroup className="rounded-lg border-input/30 bg-input/30 shadow-none">
        <InputGroupInput
          aria-label={`Search ${providerLabel} models`}
          className="[&::-webkit-search-cancel-button]:appearance-none"
          disabled={!hasModels}
          onChange={(event) => setModelsSearch(event.target.value)}
          placeholder="Search models"
          type="search"
          value={modelsSearch}
        />
        <InputGroupAddon>
          <SearchIcon aria-hidden="true" className="size-4 shrink-0 opacity-50" />
        </InputGroupAddon>
      </InputGroup>
      <div
        aria-label={`${providerLabel} fetched models`}
        className="max-h-48 overflow-y-auto rounded-md border border-border-subtle"
      >
        {hasModels ? (
          filteredModels.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-text-secondary">
              No models match your search.
            </p>
          ) : (
            sortByEnabledOrder(filteredModels, library.enabledModelIds, (model) => model.id).map(
              (model) => (
                <div
                  className="flex items-center justify-between border-b border-border-subtle px-3 py-2.5 last:border-b-0"
                  key={model.id}
                  ref={modelReorderAnimation.itemRef(model.id)}
                >
                  <span className="font-mono text-sm">{model.name}</span>
                  <Toggle
                    aria-label={`Enable ${model.name}`}
                    checked={model.enabled}
                    onCheckedChange={(enabled) => {
                      modelReorderAnimation.capture()
                      void toggleModel(model, enabled)
                    }}
                  />
                </div>
              )
            )
          )
        ) : (
          <p className="px-3 py-8 text-center text-sm text-text-secondary">
            Fetch models to get started.
          </p>
        )}
      </div>
    </section>
  )
}

export { ProviderModelsSection }
