import { Button, InputGroupInput, Popover, PopoverContent, PopoverTrigger } from '@mico/ui'
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleXIcon,
  LoaderCircleIcon,
  SearchIcon,
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
  const [isOpen, setIsOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const searchRef = React.useRef<HTMLInputElement>(null)
  const filteredModels = models.filter((model) =>
    model.name.toLowerCase().includes(search.toLowerCase())
  )

  React.useEffect(() => {
    const animationFrame = isOpen ? requestAnimationFrame(() => searchRef.current?.focus()) : null

    return () => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame)
    }
  }, [isOpen])

  function handleOpenChange(open: boolean) {
    setIsOpen(open)
    if (!open) setSearch('')
  }

  function handleTestModel(modelId: string) {
    onTestModel(modelId)
    handleOpenChange(false)
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild disabled={!hasModels}>
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
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-0 overflow-hidden p-0">
        <div className="border-b border-border/70 px-3 transition-colors hover:bg-accent/40">
          <div className="flex h-10 items-center gap-2">
            <SearchIcon aria-hidden="true" className="size-4 shrink-0 opacity-50" />
            <InputGroupInput
              aria-label={`Search ${providerLabel} models`}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
                  event.stopPropagation()
                }
              }}
              placeholder="Search models"
              ref={searchRef}
              value={search}
            />
          </div>
        </div>
        <div
          aria-label={`${providerLabel} models`}
          className="max-h-56 overflow-y-auto p-1"
          role="listbox"
        >
          {!hasModels ? (
            <p className="py-6 text-center text-sm text-text-secondary">
              Fetch models before testing.
            </p>
          ) : filteredModels.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-secondary">No models found.</p>
          ) : (
            filteredModels.map((model) => (
              <Button
                className="h-auto min-h-8 w-full justify-start rounded-sm px-2 py-1.5 text-left text-sm focus-visible:border-transparent focus-visible:bg-accent focus-visible:ring-0"
                disabled={isTesting}
                key={model.id}
                onClick={() => handleTestModel(model.modelId)}
                role="option"
                type="button"
                variant="ghost"
              >
                {model.name}
              </Button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { ProviderTestMenu, type ProviderTestState }
