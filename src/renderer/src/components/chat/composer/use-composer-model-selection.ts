import * as React from 'react'

import {
  useProviderLibraryActions,
  useProviderLibraryState
} from '@renderer/components/settings/providers/provider-library'

import { getEligibleModels } from './chat-model-selector'

type UseComposerModelSelectionOptions = {
  onModelSelected: () => Promise<void>
  selectedModelEntryId?: string | null
  selectSessionModel?: (modelEntryId: string) => Promise<void>
}

type ComposerModelSelection = {
  hasSelectedModel: boolean
  currentModelId: string | null | undefined
  library: ReturnType<typeof useProviderLibraryState>['library']
  selectModel: (modelId: string) => Promise<void>
  selectionError: string | null
}

function useComposerModelSelection({
  onModelSelected,
  selectedModelEntryId,
  selectSessionModel
}: UseComposerModelSelectionOptions): ComposerModelSelection {
  const { library, loadError } = useProviderLibraryState()
  const { selectModel: selectLibraryModel } = useProviderLibraryActions()
  const [selectionError, setSelectionError] = React.useState<string | null>(null)

  const selectModel = React.useCallback(
    async (modelId: string): Promise<void> => {
      try {
        if (selectSessionModel) await selectSessionModel(modelId)
        else await selectLibraryModel(modelId)
        setSelectionError(null)
        await onModelSelected()
      } catch {
        setSelectionError(
          'Could not select this model. Verify its provider settings and try again.'
        )
      }
    },
    [onModelSelected, selectLibraryModel, selectSessionModel]
  )
  const currentModelId = selectedModelEntryId ?? library?.selectedModelId
  const hasSelectedModel = getEligibleModels(library).some(({ id }) => id === currentModelId)

  return {
    currentModelId,
    hasSelectedModel,
    library,
    selectModel,
    selectionError: loadError ?? selectionError
  }
}

export { useComposerModelSelection }
