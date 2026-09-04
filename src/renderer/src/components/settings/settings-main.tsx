import { Button, Separator } from '@mico/ui'
import { Bot } from 'lucide-react'
import * as React from 'react'

import { ProvidersSidebar, type ProviderId } from './providers/providers-sidebar'

function SettingsMain(): React.JSX.Element {
  const [activeProviderId, setActiveProviderId] = React.useState<ProviderId>('ollama')
  const activeProviderLabel = activeProviderId === 'lm-studio' ? 'LM Studio' : 'Ollama'

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
          <ProvidersSidebar activeProviderId={activeProviderId} onSelect={setActiveProviderId} />
          <main
            aria-label="Provider configuration"
            className="min-h-0 min-w-0 flex-1 rounded-lg border border-border-subtle bg-surface-primary shadow-sm"
          >
            <header className="p-6">
              <h2 className="text-xl font-semibold text-text-primary">{activeProviderLabel}</h2>
            </header>
          </main>
        </div>
      </div>
      <footer className="flex shrink-0 items-center justify-between border-t border-border-subtle px-6 py-4">
        <p className="text-sm text-text-secondary">All changes saved</p>
        <div className="flex gap-2">
          <Button variant="outline">Close</Button>
          <Button disabled>Save</Button>
        </div>
      </footer>
    </div>
  )
}

export { SettingsMain }
