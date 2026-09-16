import type { ProviderLibrary } from '@shared/data/schemas/provider'
import * as React from 'react'

import { getEligibleModels } from './chat-model-selector'

type UseComposerModelSelectionOptions = {
  onModelSelected: () => Promise<void>
  selectedModelEntryId?: string | null
  selectSessionModel?: (modelEntryId: string) => Promise<void>
}

type ComposerModelSelection = {
  hasSelectedModel: boolean
  currentModelId: string | null | undefined
  library: ProviderLibrary | null
  selectModel: (modelId: string) => Promise<void>
  selectionError: string | null
}

function useComposerModelSelection({
  onModelSelected,
  selectedModelEntryId,
  selectSessionModel
}: UseComposerModelSelectionOptions): ComposerModelSelection {
  const [library, setLibrary] = React.useState<ProviderLibrary | null>(null)
  const [selectionError, setSelectionError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let active = true

    void (async (): Promise<void> => {
      try {
        const nextLibrary = await window.api.providers.getLibrary()
        if (active) setLibrary(nextLibrary)
      } catch {
        if (active) setSelectionError('Could not load models. Open Settings and try again.')
      }
    })()

    return () => {
      active = false
    }
  }, [])

  const selectModel = React.useCallback(
    async (modelId: string): Promise<void> => {
      try {
        if (selectSessionModel) await selectSessionModel(modelId)
        else await window.api.providers.selectModel(modelId)
        const nextLibrary = await window.api.providers.getLibrary()
        setLibrary(nextLibrary)
        setSelectionError(null)
        await onModelSelected()
      } catch {
        setSelectionError(
          'Could not select this model. Verify its provider settings and try again.'
        )
      }
    },
    [onModelSelected, selectSessionModel]
  )
  const currentModelId = selectedModelEntryId ?? library?.selectedModelId
  const hasSelectedModel = getEligibleModels(library).some(({ id }) => id === currentModelId)

  return { currentModelId, hasSelectedModel, library, selectModel, selectionError }
}

export { useComposerModelSelection }
