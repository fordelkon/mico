import { Button, InputGroup, InputGroupInput, Separator } from '@mico/ui'
import type { CustomProvider } from '@shared/data/schemas/provider'
import { BoxesIcon, CloudIcon, PlusIcon, Search, ServerIcon, TerminalIcon } from 'lucide-react'
import * as React from 'react'

import './providers-sidebar.css'

import { CustomProviderDialog } from './custom-provider-dialog'
import { customProviderLogoSources } from './custom-provider-logo-icons'

import lmStudioIcon from '@renderer/assets/providers/lmstudio.svg'
import ollamaDarkIcon from '@renderer/assets/providers/ollama-dark.svg'
import ollamaLightIcon from '@renderer/assets/providers/ollama-light.svg'
import { sortByEnabledOrder } from '@renderer/utils/enabled-order'

type ProviderId = string

type ProviderDescriptor = {
  icon?: string
  id: ProviderId
  label: string
  customIcon?: CustomProvider['icon']
}

const providerDescriptors: ProviderDescriptor[] = [
  { id: 'lm-studio', label: 'LM Studio', icon: lmStudioIcon },
  { id: 'ollama', label: 'Ollama', icon: ollamaLightIcon }
]

const builtInProviderIds = providerDescriptors.map(({ id }) => id)

const customProviderLogoSourcesById = new Map<string, string>(
  customProviderLogoSources.map(({ id, source }) => [id, source])
)

function CustomProviderIcon({ icon }: { icon: CustomProvider['icon'] }): React.JSX.Element {
  switch (icon) {
    case 'cloud':
      return <CloudIcon aria-hidden="true" className="size-6 rounded-sm" />
    case 'server':
      return <ServerIcon aria-hidden="true" className="size-6 rounded-sm" />
    case 'terminal':
      return <TerminalIcon aria-hidden="true" className="size-6 rounded-sm" />
    case 'default':
      return <BoxesIcon aria-hidden="true" className="size-6 rounded-sm" />
    default: {
      const source = customProviderLogoSourcesById.get(icon)

      return source ? (
        <img alt="" aria-hidden="true" className="size-6 rounded-sm" src={source} />
      ) : (
        <BoxesIcon aria-hidden="true" className="size-6 rounded-sm" />
      )
    }
  }
}

function ProvidersSidebar({
  activeProviderId,
  customProviders,
  enabledProviderIds = [],
  onSelect,
  onCustomProviderAdded
}: {
  activeProviderId: ProviderId
  customProviders: CustomProvider[]
  enabledProviderIds?: ProviderId[]
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
                  className={
                    isActive
                      ? 'relative h-10 w-full justify-start bg-sidebar-accent px-2 text-sidebar-accent-foreground shadow-sm after:absolute after:-left-1 after:h-5 after:w-0.5 after:rounded-full after:bg-primary'
                      : 'h-10 w-full justify-start px-2'
                  }
                  key={provider.id}
                  onClick={() => onSelect(provider.id)}
                  variant="ghost"
                >
                  <span className="relative shrink-0">
                    {provider.id === 'ollama' ? (
                      <>
                        <img
                          alt=""
                          aria-hidden="true"
                          className="size-6 shrink-0 rounded-sm dark:hidden"
                          src={ollamaLightIcon}
                        />
                        <img
                          alt=""
                          aria-hidden="true"
                          className="hidden size-6 shrink-0 rounded-sm dark:block"
                          src={ollamaDarkIcon}
                        />
                      </>
                    ) : provider.icon ? (
                      <img
                        alt=""
                        aria-hidden="true"
                        className="size-6 rounded-sm"
                        src={provider.icon}
                      />
                    ) : provider.customIcon ? (
                      <CustomProviderIcon icon={provider.customIcon} />
                    ) : (
                      <BoxesIcon aria-hidden="true" className="size-6 rounded-sm" />
                    )}
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
