import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input
} from '@mico/ui'
import type { ModelEntry, ProviderLibrary } from '@shared/data/schemas/provider'
import { ChevronDownIcon, SearchIcon } from 'lucide-react'
import * as React from 'react'

type EligibleModel = ModelEntry & { providerLabel: string }

type ChatModelSelectorProps = {
  library: ProviderLibrary | null
  onSelect: (modelId: string) => void
}

function getProviderLabel(library: ProviderLibrary, providerId: string): string {
  const customProvider = library.customProviders.find(({ id }) => id === providerId)
  if (customProvider) return customProvider.name
  if (providerId === 'lm-studio') return 'LM Studio'
  if (providerId === 'ollama') return 'Ollama'
  return providerId
}

function getEligibleModels(library: ProviderLibrary | null): EligibleModel[] {
  if (!library) return []

  const enabledProviderIds = new Set([
    ...library.configurations.filter(({ enabled }) => enabled).map(({ provider }) => provider),
    ...library.customProviders.filter(({ enabled }) => enabled).map(({ id }) => id)
  ])

  return library.models.flatMap((model) => {
    if (!model.enabled || !enabledProviderIds.has(model.provider)) return []

    return [{ ...model, providerLabel: getProviderLabel(library, model.provider) }]
  })
}

function ChatModelSelector({ library, onSelect }: ChatModelSelectorProps): React.JSX.Element {
  const [isOpen, setIsOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const eligibleModels = getEligibleModels(library)
  const selectedModel = eligibleModels.find(({ id }) => id === library?.selectedModelId)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleModels = normalizedQuery
    ? eligibleModels.filter(({ displayName, modelId, providerLabel }) =>
        [displayName, modelId, providerLabel].some((value) =>
          value.toLocaleLowerCase().includes(normalizedQuery)
        )
      )
    : eligibleModels
  const modelsByProvider = Map.groupBy(visibleModels, ({ providerLabel }) => providerLabel)

  return (
    <DropdownMenu
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open)
        if (!open) setQuery('')
      }}
    >
      <DropdownMenuTrigger asChild disabled={!library}>
        <Button className="h-8 gap-1.5 px-2 text-xs" type="button" variant="ghost">
          <span className="max-w-44 truncate">{selectedModel?.displayName ?? 'Select model'}</span>
          <ChevronDownIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <div className="relative p-2">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            autoFocus
            className="h-8 pl-7 text-xs"
            placeholder="Search models"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </div>
        <DropdownMenuSeparator />
        {modelsByProvider.size ? (
          <DropdownMenuRadioGroup value={library?.selectedModelId ?? ''} onValueChange={onSelect}>
            {[...modelsByProvider].map(([providerLabel, models]) => (
              <React.Fragment key={providerLabel}>
                <DropdownMenuLabel>{providerLabel}</DropdownMenuLabel>
                {models.map((model) => (
                  <DropdownMenuRadioItem key={model.id} value={model.id}>
                    <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                      <span className="truncate">{model.displayName}</span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
                <DropdownMenuSeparator />
              </React.Fragment>
            ))}
          </DropdownMenuRadioGroup>
        ) : (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            Enable a provider and model in Settings to chat.
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { ChatModelSelector, getEligibleModels }
