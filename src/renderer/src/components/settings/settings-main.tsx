import { Separator } from '@mico/ui'
import { Bot } from 'lucide-react'

function SettingsMain(): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 px-8 py-6">
        <div className="flex items-center gap-2">
          <Bot aria-hidden="true" className="size-5 text-text-secondary" />
          <h1 className="text-xl font-semibold text-text-primary">Providers</h1>
        </div>
      </header>
      <Separator className="bg-border-subtle" />
      <div aria-label="Providers content" className="min-h-0 flex-1" />
    </div>
  )
}

export { SettingsMain }
