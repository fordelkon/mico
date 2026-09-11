import { Separator } from '@mico/ui'
import { Bot } from 'lucide-react'
import * as React from 'react'

import { sortByEnabledOrder } from '@renderer/utils/enabled-order'
import { useListReorderAnimation } from '@renderer/hooks/use-list-reorder-animation'

import {
  builtInProviderIds,
  ProvidersSidebar,
  type ProviderId
} from './providers/providers-sidebar'
import { useProviderLibrary } from './providers/provider-library'
import { ProvidersSection } from './providers/providers-section'
import { AppearanceSettings } from './appearances/appearance-settings'

function SettingsContent(): React.JSX.Element {
  const initialProviderId = builtInProviderIds[0] ?? 'lm-studio'
  const [activeProviderId, setActiveProviderId] = React.useState<ProviderId>(initialProviderId)
  const hasSelectedDefaultProvider = React.useRef(false)
  const providerReorderAnimation = useListReorderAnimation()
  const { isLoaded, library, selectProvider } = useProviderLibrary()
  const getFirstProviderId = React.useCallback(
    (customProviderIds: ProviderId[]) =>
      sortByEnabledOrder(
        [...builtInProviderIds, ...customProviderIds],
        library.enabledProviderIds,
        (providerId) => providerId
      )[0] ?? initialProviderId,
    [initialProviderId, library.enabledProviderIds]
  )

  React.useEffect(() => {
    if (!isLoaded || hasSelectedDefaultProvider.current) return

    const providerIds = [...builtInProviderIds, ...library.customProviders.map(({ id }) => id)]
    const fallbackProviderId = getFirstProviderId(library.customProviders.map(({ id }) => id))
    const restoredProviderId =
      library.selectedProviderId && providerIds.includes(library.selectedProviderId)
        ? library.selectedProviderId
        : fallbackProviderId

    setActiveProviderId(restoredProviderId)
    if (library.selectedProviderId && library.selectedProviderId !== restoredProviderId)
      void selectProvider(restoredProviderId)
    hasSelectedDefaultProvider.current = true
  }, [
    getFirstProviderId,
    isLoaded,
    library.customProviders,
    library.selectedProviderId,
    selectProvider
  ])

  const selectProviderPage = (providerId: ProviderId): void => {
    setActiveProviderId(providerId)
    void selectProvider(providerId)
  }

  return (
    <div className="paper-canvas flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 px-8 py-6">
        <div className="flex items-center gap-2">
          <Bot aria-hidden="true" className="size-5 text-text-secondary" />
          <h1 className="text-xl font-semibold text-text-primary">Providers</h1>
        </div>
      </header>
      <Separator className="bg-border-subtle" />
      <div className="min-h-0 flex-1 overflow-hidden p-2">
        <div className="flex size-full min-h-0 gap-3">
          <ProvidersSidebar
            activeProviderId={activeProviderId}
            customProviders={library.customProviders}
            enabledProviderIds={library.enabledProviderIds}
            itemRef={providerReorderAnimation.itemRef}
            onCustomProviderAdded={selectProviderPage}
            onSelect={selectProviderPage}
          />
          <ProvidersSection
            key={activeProviderId}
            onCustomProviderRemoved={(providerId) => {
              const fallbackProviderId = getFirstProviderId(
                library.customProviders.filter(({ id }) => id !== providerId).map(({ id }) => id)
              )
              selectProviderPage(fallbackProviderId)
            }}
            onProviderReorder={providerReorderAnimation.capture}
            providerId={activeProviderId}
          />
        </div>
      </div>
    </div>
  )
}

function SettingsMain({
  page = 'providers'
}: {
  page?: 'providers' | 'appearance'
}): React.JSX.Element {
  if (page === 'appearance') return <AppearanceSettings />
  return <SettingsContent />
}

export { SettingsMain }
export default SettingsMain
