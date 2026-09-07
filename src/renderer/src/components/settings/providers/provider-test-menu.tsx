import {
  DropdownMenuItem,
  IconMenuButton,
  InputGroup,
  InputGroupAddon,
  InputGroupInput
} from '@mico/ui'
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

  return (
    <IconMenuButton
      className="h-8 w-12 gap-1 px-1.5"
      disabled={!hasModels}
      icon={
        <>
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
        </>
      }
      label={`Test ${providerLabel} model`}
      menuAlign="end"
      menuContentClassName="w-72"
      onOpenChange={setIsOpen}
      variant="outline"
    >
      <div>
        <div className="p-1 pb-0">
          <InputGroup className="h-8! rounded-lg! border-input/30 bg-input/30 shadow-none! *:data-[slot=input-group-addon]:pl-2!">
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
            <InputGroupAddon>
              <SearchIcon aria-hidden="true" className="size-4 shrink-0 opacity-50" />
            </InputGroupAddon>
          </InputGroup>
        </div>
        <div className="max-h-56 overflow-y-auto p-1">
          {!hasModels ? (
            <p className="py-6 text-center text-sm text-text-secondary">
              Fetch models before testing.
            </p>
          ) : filteredModels.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-secondary">No models found.</p>
          ) : (
            filteredModels.map((model) => (
              <DropdownMenuItem
                className="rounded-sm px-2 py-1.5"
                disabled={isTesting}
                key={model.id}
                onSelect={() => onTestModel(model.modelId)}
              >
                {model.name}
              </DropdownMenuItem>
            ))
          )}
        </div>
      </div>
    </IconMenuButton>
  )
}

export { ProviderTestMenu, type ProviderTestState }
