import { Button, SearchPopover, Spinner } from '@mico/ui'
import { useGlidingHighlight } from '@renderer/hooks/use-gliding-highlight'
import { CheckCircle2Icon, ChevronDownIcon, CircleXIcon, ZapIcon } from 'lucide-react'
import * as React from 'react'

import type { CatalogModel } from './provider-library'

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
  models: CatalogModel[]
  onTestModel: (modelId: string) => void
  providerLabel: string
  testState: ProviderTestState
}): React.JSX.Element {
  const { clearHighlight, getItemProps, highlightProps } = useGlidingHighlight<HTMLButtonElement>()

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
            <Spinner aria-label={`Testing ${providerLabel} model`} />
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
            className="relative max-h-56 overflow-y-auto p-1"
            onMouseLeave={clearHighlight}
            role="listbox"
          >
            {filteredModels.length === 0 ? (
              <p className="py-6 text-center text-sm text-text-secondary">No models found.</p>
            ) : (
              <>
                <span
                  {...highlightProps}
                  className={`${highlightProps.className} inset-x-1 rounded-sm bg-accent`}
                />
                {filteredModels.map((model, index) => (
                  <Button
                    {...getItemProps(index)}
                    className="relative z-10 h-auto min-h-8 w-full justify-start rounded-sm px-2 py-1.5 text-left text-sm hover:bg-transparent focus-visible:border-transparent focus-visible:bg-transparent focus-visible:ring-0"
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
                ))}
              </>
            )}
          </div>
        )
      }}
    </SearchPopover>
  )
}

export { ProviderTestMenu, type ProviderTestState }
