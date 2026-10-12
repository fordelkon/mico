import { Button, SearchPopover } from '@mico/ui'
import { useGlidingHighlight } from '@renderer/hooks/use-gliding-highlight'
import type { CustomProvider, ModelEntry } from '@shared/data/schemas/provider'
import type { ProviderCatalog } from '@renderer/components/settings/providers/provider-library'
import { BoxesIcon, ChevronDownIcon } from 'lucide-react'
import * as React from 'react'

import { ProviderIcon } from '@renderer/components/providers/provider-icon'

import { handleComposerListNavigation } from './composer-list-navigation'

type EligibleModel = ModelEntry & {
  providerIcon?: CustomProvider['icon']
  providerLabel: string
}

type ChatModelSelectorProps = {
  disabled?: boolean
  library: ProviderCatalog | null
  onSelect: (modelId: string) => void
  selectedModelId?: string | null
}

function getProviderDetails(
  library: ProviderCatalog,
  providerId: string
): Pick<EligibleModel, 'providerIcon' | 'providerLabel'> {
  const customProvider = library.customProviders.find(({ id }) => id === providerId)
  if (customProvider)
    return { providerIcon: customProvider.icon, providerLabel: customProvider.name }
  if (providerId === 'ollama') return { providerLabel: 'Ollama' }
  return { providerLabel: providerId }
}

function getEligibleModels(library: ProviderCatalog | null): EligibleModel[] {
  if (!library) return []

  const enabledProviderIds = new Set(library.enabledProviderIds)

  return library.models.flatMap((model) => {
    if (!model.enabled || !enabledProviderIds.has(model.providerId)) return []

    return [
      {
        ...getProviderDetails(library, model.providerId),
        displayName: model.name,
        enabled: model.enabled,
        id: model.id,
        modelId: model.modelId,
        // SAFETY: catalog models mirror persisted entries, whose provider is a ModelProvider.
        provider: model.providerId as ModelEntry['provider']
      }
    ]
  })
}

function ChatModelSelector({
  disabled = false,
  library,
  onSelect,
  selectedModelId
}: ChatModelSelectorProps): React.JSX.Element {
  const { clearHighlight, getItemProps, highlightProps } = useGlidingHighlight<HTMLButtonElement>()
  const eligibleModels = getEligibleModels(library)
  const currentModelId = selectedModelId ?? library?.selectedModelId
  const selectedModel = eligibleModels.find(({ id }) => id === currentModelId)

  return (
    <div className="chat-model-selector min-w-0" onKeyDownCapture={handleComposerListNavigation}>
      <SearchPopover
        align="end"
        contentClassName="w-96 max-w-[calc(100vw-2rem)]"
        searchLabel="Search models"
        searchPlaceholder="Search models"
        side="top"
        trigger={
          <Button
            aria-label={selectedModel?.displayName ?? 'Select model'}
            className="chat-model-selector__trigger h-7 min-w-0 max-w-40 shrink gap-1.5 px-2 text-xs font-normal text-text-secondary"
            disabled={disabled || !library}
            type="button"
            variant="ghost"
          >
            {selectedModel ? (
              <ProviderIcon
                className="size-4 shrink-0 rounded-sm"
                customIcon={selectedModel.providerIcon}
                providerId={selectedModel.provider}
              />
            ) : (
              // A generic model icon keeps the trigger identifiable when the
              // narrow footer truncates the "Select model" label away.
              <BoxesIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="chat-composer-footer__label truncate">
              {selectedModel?.displayName ?? 'Select model'}
            </span>
            <ChevronDownIcon
              aria-hidden="true"
              className="chat-composer-footer__chevron size-3.5 text-muted-foreground"
            />
          </Button>
        }
      >
        {({ close, query }) => {
          const normalizedQuery = query.trim().toLocaleLowerCase()
          const visibleModels = normalizedQuery
            ? eligibleModels.filter(({ displayName, modelId, providerLabel }) =>
                [displayName, modelId, providerLabel].some((item) =>
                  item.toLocaleLowerCase().includes(normalizedQuery)
                )
              )
            : eligibleModels
          const modelsByProvider = Map.groupBy(visibleModels, ({ provider }) => provider)
          const modelIndexes = new Map(visibleModels.map((model, index) => [model.id, index]))

          return modelsByProvider.size ? (
            <div
              aria-label="Available models"
              className="relative max-h-[min(20rem,calc(var(--radix-popover-content-available-height)-2.5rem))] overflow-y-auto p-1"
              onMouseLeave={clearHighlight}
              role="listbox"
            >
              <span
                {...highlightProps}
                className={`${highlightProps.className} inset-x-1 rounded-md bg-accent`}
              />
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
                          {...getItemProps(modelIndexes.get(model.id) ?? 0)}
                          aria-label={model.displayName}
                          aria-selected={model.id === currentModelId}
                          className="relative z-10 h-auto min-h-8 w-full justify-between gap-3 px-2 py-1.5 text-left text-sm hover:bg-transparent focus-visible:border-transparent focus-visible:bg-transparent focus-visible:ring-0"
                          key={model.id}
                          disabled={disabled}
                          onClick={() => {
                            if (disabled) return
                            onSelect(model.id)
                            close()
                          }}
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
          )
        }}
      </SearchPopover>
    </div>
  )
}

export { ChatModelSelector, getEligibleModels }
