import { Button, Input, Popover, PopoverContent, PopoverTrigger } from '@mico/ui'
import type { CustomProvider, ModelEntry, ProviderLibrary } from '@shared/data/schemas/provider'
import { ChevronDownIcon, SearchIcon } from 'lucide-react'
import * as React from 'react'

import { ProviderIcon } from '@renderer/components/providers/provider-icon'

type EligibleModel = ModelEntry & {
  providerIcon?: CustomProvider['icon']
  providerLabel: string
}

type ChatModelSelectorProps = {
  library: ProviderLibrary | null
  onSelect: (modelId: string) => void
}

function getProviderDetails(
  library: ProviderLibrary,
  providerId: string
): Pick<EligibleModel, 'providerIcon' | 'providerLabel'> {
  const customProvider = library.customProviders.find(({ id }) => id === providerId)
  if (customProvider)
    return { providerIcon: customProvider.icon, providerLabel: customProvider.name }
  if (providerId === 'lm-studio') return { providerLabel: 'LM Studio' }
  if (providerId === 'ollama') return { providerLabel: 'Ollama' }
  return { providerLabel: providerId }
}

function getEligibleModels(library: ProviderLibrary | null): EligibleModel[] {
  if (!library) return []

  const enabledProviderIds = new Set([
    ...library.configurations.filter(({ enabled }) => enabled).map(({ provider }) => provider),
    ...library.customProviders.filter(({ enabled }) => enabled).map(({ id }) => id)
  ])

  return library.models.flatMap((model) => {
    if (!model.enabled || !enabledProviderIds.has(model.provider)) return []

    return [{ ...model, ...getProviderDetails(library, model.provider) }]
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
  const modelsByProvider = Map.groupBy(visibleModels, ({ provider }) => provider)

  function handleOpenChange(open: boolean) {
    setIsOpen(open)
    if (!open) setQuery('')
  }

  function handleSelect(modelId: string) {
    onSelect(modelId)
    handleOpenChange(false)
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild disabled={!library}>
        <Button className="h-8 gap-1.5 px-2 text-xs" type="button" variant="ghost">
          {selectedModel ? (
            <ProviderIcon
              className="size-4 shrink-0 rounded-sm"
              customIcon={selectedModel.providerIcon}
              providerId={selectedModel.provider}
            />
          ) : null}
          <span className="max-w-44 truncate">{selectedModel?.displayName ?? 'Select model'}</span>
          <ChevronDownIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 gap-0 overflow-hidden p-0">
        <div className="border-b border-border/70 px-3 transition-colors hover:bg-accent/40">
          <div className="flex h-10 items-center gap-2">
            <SearchIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            <Input
              autoFocus
              className="h-8 rounded-none border-0 bg-transparent px-0 text-xs shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
              placeholder="Search models"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        {modelsByProvider.size ? (
          <div
            aria-label="Available models"
            className="max-h-80 overflow-y-auto p-1"
            role="listbox"
          >
            <div className="flex flex-col gap-1">
              {[...modelsByProvider].map(([providerId, models], index) => {
                const [{ providerIcon, providerLabel }] = models

                return (
                  <section
                    aria-label={providerLabel}
                    className={index > 0 ? 'border-t border-border/70 pt-1' : undefined}
                    key={providerId}
                  >
                    <div className="flex items-center gap-2 px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">
                      <ProviderIcon
                        className="size-3.5 rounded-sm"
                        customIcon={providerIcon}
                        providerId={providerId}
                      />
                      <span>{providerLabel}</span>
                    </div>
                    {models.map((model) => (
                      <Button
                        aria-label={model.displayName}
                        aria-selected={model.id === library?.selectedModelId}
                        className="h-auto min-h-8 w-full justify-between gap-3 px-2 py-1.5 text-left text-sm focus-visible:border-transparent focus-visible:bg-accent focus-visible:ring-0"
                        key={model.id}
                        onClick={() => handleSelect(model.id)}
                        role="option"
                        type="button"
                        variant="ghost"
                      >
                        <span className="min-w-0 truncate">{model.displayName}</span>
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
                          {model.modelId}
                        </span>
                      </Button>
                    ))}
                  </section>
                )
              })}
            </div>
          </div>
        ) : (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            Enable a provider and model in Settings to chat.
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}

export { ChatModelSelector, getEligibleModels }
