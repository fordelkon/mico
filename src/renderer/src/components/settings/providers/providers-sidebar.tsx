import { Button, InputGroup, InputGroupInput, Separator } from '@mico/ui'
import { Search } from 'lucide-react'
import * as React from 'react'

import lmStudioIcon from '@renderer/assets/providers/lmstudio.svg'
import ollamaDarkIcon from '@renderer/assets/providers/ollama-dark.svg'
import ollamaLightIcon from '@renderer/assets/providers/ollama-light.svg'

type ProviderId = 'lm-studio' | 'ollama'

type ProviderDescriptor = {
  icon: string
  id: ProviderId
  label: string
}

const providerDescriptors: ProviderDescriptor[] = [
  { id: 'lm-studio', label: 'LM Studio', icon: lmStudioIcon },
  { id: 'ollama', label: 'Ollama', icon: ollamaLightIcon }
]

function ProvidersSidebar({
  activeProviderId,
  onSelect
}: {
  activeProviderId: ProviderId
  onSelect: (providerId: ProviderId) => void
}): React.JSX.Element {
  const [isExpanded, setIsExpanded] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const railRef = React.useRef<HTMLElement>(null)
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const collapseTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const visibleProviders = providerDescriptors.filter(({ label }) =>
    label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  )

  const clearCollapseTimer = (): void => {
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current)
      collapseTimer.current = null
    }
  }
  const collapseWhenInactive = (): void => {
    clearCollapseTimer()
    collapseTimer.current = setTimeout(() => {
      const hasFocus = railRef.current?.contains(document.activeElement)
      if (!hasFocus) {
        setIsExpanded(false)
        setQuery('')
      }
    }, 0)
  }

  React.useEffect(() => clearCollapseTimer, [])
  React.useEffect(() => {
    if (isExpanded) searchInputRef.current?.focus()
  }, [isExpanded])

  return (
    <aside
      className="shrink-0 overflow-hidden rounded-lg bg-sidebar shadow-sm ring-1 ring-border-subtle transition-[width] duration-200 ease-out"
      style={{ width: isExpanded ? '13rem' : '4rem' }}
    >
      <nav
        aria-label="Providers"
        className="flex min-h-0 flex-1 flex-col"
        onBlurCapture={collapseWhenInactive}
        onMouseLeave={collapseWhenInactive}
        ref={railRef}
      >
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
        <div className="space-y-2 px-3">
          {visibleProviders.map((provider) => {
            const isActive = provider.id === activeProviderId

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
                ) : (
                  <img
                    alt=""
                    aria-hidden="true"
                    className="size-6 shrink-0 rounded-sm"
                    src={provider.icon}
                  />
                )}
                {isExpanded && <span className="ml-2 truncate">{provider.label}</span>}
              </Button>
            )
          })}
        </div>
      </nav>
    </aside>
  )
}

export { ProvidersSidebar }
export type { ProviderId }
