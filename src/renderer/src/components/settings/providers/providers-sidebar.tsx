import { Button, InputGroup, InputGroupInput, Separator } from '@mico/ui'
import type { CustomProvider } from '@shared/data/schemas/provider'
import { PlusIcon, Search } from 'lucide-react'
import * as React from 'react'

import './providers-sidebar.css'

import { ProviderIcon } from '@renderer/components/providers/provider-icon'
import { CustomProviderDialog } from './custom-provider-dialog'
import { sortByEnabledOrder } from '@renderer/utils/enabled-order'

type ProviderId = string

type ProviderDescriptor = {
  id: ProviderId
  label: string
  customIcon?: CustomProvider['icon']
}

const providerDescriptors: ProviderDescriptor[] = [
  { id: 'lm-studio', label: 'LM Studio' },
  { id: 'ollama', label: 'Ollama' }
]

const builtInProviderIds = providerDescriptors.map(({ id }) => id)

function ProvidersSidebar({
  activeProviderId,
  customProviders,
  enabledProviderIds = [],
  itemRef,
  onSelect,
  onCustomProviderAdded
}: {
  activeProviderId: ProviderId
  customProviders: CustomProvider[]
  enabledProviderIds?: ProviderId[]
  itemRef?: (providerId: ProviderId) => (element: HTMLButtonElement | null) => void
  onSelect: (providerId: ProviderId) => void
  onCustomProviderAdded: (providerId: ProviderId) => void
}): React.JSX.Element {
  const [isAddProviderDialogOpen, setIsAddProviderDialogOpen] = React.useState(false)
  const isAddProviderDialogOpenRef = React.useRef(false)
  const [isExpanded, setIsExpanded] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const railRef = React.useRef<HTMLElement>(null)
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const visibleProviders = sortByEnabledOrder(
    [
      ...providerDescriptors,
      ...customProviders.map<ProviderDescriptor>(({ icon, id, name }) => ({
        customIcon: icon,
        id,
        label: name
      }))
    ].filter(({ label }) => label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),
    enabledProviderIds,
    ({ id }) => id
  )

  const collapse = (): void => {
    setIsExpanded(false)
    setQuery('')
  }
  const collapseWhenFocusLeavesRail = (event: React.FocusEvent<HTMLElement>): void => {
    if (isAddProviderDialogOpenRef.current) {
      return
    }

    if (!railRef.current?.contains(event.relatedTarget)) {
      collapse()
    }
  }
  const collapseWhenPointerLeavesRail = (): void => {
    if (!isAddProviderDialogOpenRef.current && !railRef.current?.contains(document.activeElement)) {
      collapse()
    }
  }
  const setAddProviderDialogOpen = (open: boolean): void => {
    isAddProviderDialogOpenRef.current = open
    setIsAddProviderDialogOpen(open)
  }
  React.useEffect(() => {
    if (isExpanded) searchInputRef.current?.focus()
  }, [isExpanded])

  return (
    <aside
      className="flex h-full shrink-0 flex-col overflow-hidden rounded-lg bg-sidebar shadow-sm ring-1 ring-border-subtle transition-[width] duration-200 ease-out"
      onBlurCapture={collapseWhenFocusLeavesRail}
      onMouseLeave={collapseWhenPointerLeavesRail}
      ref={railRef}
      style={{ width: isExpanded ? '13rem' : '4rem' }}
    >
      <nav aria-label="Providers" className="flex min-h-0 flex-1 flex-col">
        <div className="relative flex h-12 items-center">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-6 z-10 size-4 text-muted-foreground"
          />
          {isExpanded ? (
            <InputGroup aria-label="Provider search" className="mx-4">
              <InputGroupInput
                aria-label="Search providers"
                className="pl-8"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search providers"
                ref={searchInputRef}
                type="search"
                value={query}
              />
            </InputGroup>
          ) : (
            <Button
              aria-label="Search providers"
              className="mx-auto size-10"
              onClick={() => setIsExpanded(true)}
              size="icon"
              variant="ghost"
            />
          )}
        </div>
        <Separator className="mx-auto mb-3 w-12 bg-border-subtle" />
        <div className="min-h-0 flex-1 overflow-y-auto px-3">
          <div className="space-y-2">
            {visibleProviders.map((provider) => {
              const isActive = provider.id === activeProviderId
              const isEnabled = enabledProviderIds.includes(provider.id)

              return (
                <Button
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={provider.label}
                  className="relative h-10 w-full justify-start px-2 hover:bg-sidebar-row-hover hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-row-active data-[active=true]:text-sidebar-accent-foreground data-[active=true]:shadow-[var(--sidebar-row-active-shadow)] data-[active=true]:hover:bg-sidebar-row-active data-[active=true]:after:absolute data-[active=true]:after:-left-1 data-[active=true]:after:h-5 data-[active=true]:after:w-0.5 data-[active=true]:after:rounded-full data-[active=true]:after:bg-primary"
                  data-active={isActive}
                  key={provider.id}
                  onClick={() => onSelect(provider.id)}
                  ref={itemRef?.(provider.id)}
                  variant="ghost"
                >
                  <span className="relative shrink-0">
                    <ProviderIcon customIcon={provider.customIcon} providerId={provider.id} />
                    {!isExpanded ? (
                      <span
                        aria-hidden="true"
                        className="providers-sidebar__badge"
                        data-open={isEnabled}
                      >
                        <span className="providers-sidebar__badge-dot" />
                      </span>
                    ) : null}
                  </span>
                  {isExpanded && <span className="ml-2 truncate">{provider.label}</span>}
                  {isExpanded && isEnabled ? (
                    <span
                      aria-hidden="true"
                      className="ml-auto size-2 shrink-0 rounded-full bg-primary"
                    />
                  ) : null}
                </Button>
              )
            })}
          </div>
        </div>
      </nav>
      <div className="relative z-10 h-16 shrink-0">
        <Separator className="absolute top-4 left-1/2 w-12 -translate-x-1/2 bg-border-subtle" />
        <CustomProviderDialog
          onAdded={onCustomProviderAdded}
          onOpenChange={setAddProviderDialogOpen}
          open={isAddProviderDialogOpen}
        >
          <Button
            aria-label="Add custom provider"
            className="absolute top-5 left-3 h-10 justify-start gap-0 overflow-hidden px-2 transition-[width] duration-200 ease-out"
            style={{ width: isExpanded ? 'calc(100% - 1.5rem)' : '2.5rem' }}
            title="Add custom provider"
            variant="ghost"
          >
            <span className="flex size-6 shrink-0 items-center justify-center">
              <PlusIcon aria-hidden="true" />
            </span>
            <span
              className={`ml-2 whitespace-nowrap transition-opacity duration-150 ${
                isExpanded ? 'opacity-100' : 'opacity-0'
              }`}
            >
              Custom Provider
            </span>
          </Button>
        </CustomProviderDialog>
      </div>
    </aside>
  )
}

export { ProvidersSidebar, builtInProviderIds }
export type { ProviderId }
