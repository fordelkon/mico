import { Button, SearchPopover } from '@mico/ui'
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleXIcon,
  LoaderCircleIcon,
  ZapIcon
} from 'lucide-react'
import * as React from 'react'

import type { ProviderModel } from './provider-library'

type ProviderTestState = 'error' | 'idle' | 'success' | 'testing'

function ProviderTestMenu({
  hasModels,
  isTesting,
  models,
  onTestModel,
  providerLabel,
  testState
}: {
  hasModels: boolean
  isTesting: boolean
  models: ProviderModel[]
  onTestModel: (modelId: string) => void
  providerLabel: string
  testState: ProviderTestState
}): React.JSX.Element {
  return (
    <SearchPopover
      align="end"
      contentClassName="w-72"
      searchLabel={`Search ${providerLabel} models`}
      searchPlaceholder="Search models"
      trigger={
        <Button
          aria-label={`Test ${providerLabel} model`}
          className="h-8 w-12 gap-1 px-1.5"
          disabled={!hasModels}
          type="button"
          variant="outline"
        >
          {testState === 'testing' ? (
            <LoaderCircleIcon
              aria-label={`Testing ${providerLabel} model`}
              className="animate-spin"
            />
          ) : testState === 'success' ? (
            <CheckCircle2Icon
              aria-label={`${providerLabel} model test succeeded`}
              className="text-emerald-600"
            />
          ) : testState === 'error' ? (
            <CircleXIcon
              aria-label={`${providerLabel} model test failed`}
              className="text-destructive"
            />
          ) : (
            <ZapIcon aria-hidden="true" />
          )}
          <ChevronDownIcon aria-hidden="true" className="size-3" />
        </Button>
      }
    >
      {({ close, query }) => {
        const filteredModels = models.filter((model) =>
          model.name.toLowerCase().includes(query.toLowerCase())
        )

        return (
          <div
            aria-label={`${providerLabel} models`}
            className="max-h-56 overflow-y-auto p-1"
            role="listbox"
          >
            {filteredModels.length === 0 ? (
              <p className="py-6 text-center text-sm text-text-secondary">No models found.</p>
            ) : (
              filteredModels.map((model) => (
                <Button
                  className="h-auto min-h-8 w-full justify-start rounded-sm px-2 py-1.5 text-left text-sm focus-visible:border-transparent focus-visible:bg-accent focus-visible:ring-0"
                  disabled={isTesting}
                  key={model.id}
                  onClick={() => {
                    onTestModel(model.modelId)
                    close()
                  }}
                  role="option"
                  type="button"
                  variant="ghost"
                >
                  {model.name}
                </Button>
              ))
            )}
          </div>
        )
      }}
    </SearchPopover>
  )
}

export { ProviderTestMenu, type ProviderTestState }
