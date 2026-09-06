import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Input,
  Textarea,
  Toggle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@mico/ui'
import { CustomProviderSchema } from '@shared/data/schemas/provider'
import { BoxesIcon, ChevronDownIcon, CloudIcon, ServerIcon, TerminalIcon } from 'lucide-react'
import * as React from 'react'

import { customProviderLogoSources } from './custom-provider-logo-icons'
import { useProviderLibrary } from './provider-library'

type CustomProviderIcon = {
  id: string
  label: string
  preview: React.ReactNode
}

const customProviderApiFormats = [
  { label: 'Chat Completions (/chat/completions)', value: 'openai-compatible' },
  { label: 'Responses (/responses)', value: 'openai-responses' },
  { label: 'Anthropic Messages (v1/messages)', value: 'anthropic-compatible' }
] as const

const customProviderIcons = [
  {
    id: 'default',
    label: 'Default icon',
    preview: <BoxesIcon aria-hidden="true" className="size-5" />
  },
  { id: 'cloud', label: 'Cloud', preview: <CloudIcon aria-hidden="true" className="size-5" /> },
  { id: 'server', label: 'Server', preview: <ServerIcon aria-hidden="true" className="size-5" /> },
  {
    id: 'terminal',
    label: 'Terminal',
    preview: <TerminalIcon aria-hidden="true" className="size-5" />
  }
] satisfies CustomProviderIcon[]

const knownLogoLabels = {
  ai21: 'AI21',
  deepseek: 'DeepSeek',
  openai: 'OpenAI',
  qwen: 'Qwen'
} satisfies Record<string, string>

function formatLogoLabel(id: string): string {
  return (
    knownLogoLabels[id] ??
    id
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  )
}

const customProviderLogoIcons = customProviderLogoSources
  .map(({ id, source }) => ({
    id,
    label: formatLogoLabel(id),
    preview: <img alt="" aria-hidden="true" className="size-5" src={source} />
  }))
  .sort((left, right) => left.label.localeCompare(right.label)) satisfies CustomProviderIcon[]

function CustomProviderDialog({
  children,
  onAdded,
  onOpenChange,
  open
}: {
  children: React.ReactElement
  onAdded: (providerId: string) => void
  onOpenChange: (open: boolean) => void
  open: boolean
}): React.JSX.Element {
  const { addCustomProvider } = useProviderLibrary()
  const [customProviderIcon, setCustomProviderIcon] = React.useState('default')
  const [customProviderName, setCustomProviderName] = React.useState('')
  const [customProviderBaseUrl, setCustomProviderBaseUrl] = React.useState('')
  const [customProviderApiKey, setCustomProviderApiKey] = React.useState('')
  const [customProviderApiFormat, setCustomProviderApiFormat] = React.useState('openai-compatible')
  const [customProviderHeaders, setCustomProviderHeaders] = React.useState('')
  const [usesMaxCompletionTokens, setUsesMaxCompletionTokens] = React.useState(false)
  const [customProviderError, setCustomProviderError] = React.useState<string | null>(null)
  const [customProviderIconSearch, setCustomProviderIconSearch] = React.useState('')
  const [isCustomProviderIconMenuOpen, setIsCustomProviderIconMenuOpen] = React.useState(false)
  const customProviderIconSearchRef = React.useRef<HTMLInputElement>(null)
  const selectedCustomProviderIcon =
    [...customProviderIcons, ...customProviderLogoIcons].find(
      (icon) => icon.id === customProviderIcon
    ) ?? customProviderIcons[0]
  const selectedCustomProviderApiFormat =
    customProviderApiFormats.find(({ value }) => value === customProviderApiFormat) ??
    customProviderApiFormats[0]
  const normalizedIconSearch = customProviderIconSearch.trim().toLocaleLowerCase()
  const visibleCustomProviderIcons = [...customProviderIcons, ...customProviderLogoIcons].filter(
    ({ id, label }) =>
      !normalizedIconSearch ||
      label.toLocaleLowerCase().includes(normalizedIconSearch) ||
      id.includes(normalizedIconSearch)
  )

  React.useEffect(() => {
    const animationFrame = isCustomProviderIconMenuOpen
      ? requestAnimationFrame(() => customProviderIconSearchRef.current?.focus())
      : null

    return () => {
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame)
      }
    }
  }, [isCustomProviderIconMenuOpen])

  const setApiFormat = (apiFormat: string): void => {
    setCustomProviderApiFormat(apiFormat)
    if (apiFormat !== 'openai-compatible') setUsesMaxCompletionTokens(false)
  }

  const resetCustomProviderForm = (): void => {
    setCustomProviderIcon('default')
    setCustomProviderName('')
    setCustomProviderBaseUrl('')
    setCustomProviderApiKey('')
    setCustomProviderApiFormat('openai-compatible')
    setCustomProviderHeaders('')
    setUsesMaxCompletionTokens(false)
    setCustomProviderError(null)
    setCustomProviderIconSearch('')
  }

  const submitCustomProvider = async (): Promise<void> => {
    let headers: unknown

    try {
      headers = customProviderHeaders.trim() ? JSON.parse(customProviderHeaders) : {}
    } catch {
      setCustomProviderError('Custom headers must be valid JSON.')
      return
    }

    const result = CustomProviderSchema.omit({ id: true }).safeParse({
      apiFormat: customProviderApiFormat,
      apiKey: customProviderApiKey.trim() || undefined,
      baseUrl: customProviderBaseUrl.trim(),
      headers,
      icon: customProviderIcon,
      name: customProviderName.trim(),
      useMaxCompletionTokens: usesMaxCompletionTokens
    })
    if (!result.success) {
      setCustomProviderError(
        result.error.issues[0]?.message ?? 'Custom provider settings are invalid.'
      )
      return
    }

    try {
      const provider = await addCustomProvider(result.data)
      onOpenChange(false)
      resetCustomProviderForm()
      onAdded(provider.id)
    } catch (error) {
      setCustomProviderError(
        error instanceof Error ? error.message : 'Unable to add the custom provider.'
      )
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className="max-h-[calc(100vh-2rem)] w-[34rem] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-6 font-sans"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-text-primary">
            Add custom provider
          </DialogTitle>
          <DialogDescription className="text-text-secondary">
            Configure an OpenAI-compatible or Anthropic-compatible provider.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto p-1">
          <div className="space-y-5">
            <label className="flex flex-col gap-2 text-sm" htmlFor="custom-provider-name">
              <span>Provider name</span>
              <Input
                id="custom-provider-name"
                onChange={(event) => setCustomProviderName(event.target.value)}
                placeholder="My Custom Provider"
                value={customProviderName}
              />
            </label>
            <fieldset aria-label="Provider icon" className="space-y-1">
              <legend className="text-sm">Icon</legend>
              <DropdownMenu onOpenChange={setIsCustomProviderIconMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label={selectedCustomProviderIcon.label}
                    className="w-full justify-between"
                    type="button"
                    variant="outline"
                  >
                    <span className="flex items-center gap-2">
                      {selectedCustomProviderIcon.preview}
                      {selectedCustomProviderIcon.label}
                    </span>
                    <ChevronDownIcon aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="max-w-[calc(100vw-4rem)]">
                  <div className="p-1">
                    <Input
                      aria-label="Search provider icons"
                      onChange={(event) => setCustomProviderIconSearch(event.target.value)}
                      onKeyDown={(event) => {
                        if (
                          event.key.length === 1 &&
                          !event.ctrlKey &&
                          !event.altKey &&
                          !event.metaKey
                        ) {
                          event.stopPropagation()
                        }
                      }}
                      placeholder="Search icons"
                      ref={customProviderIconSearchRef}
                      type="search"
                      value={customProviderIconSearch}
                    />
                  </div>
                  <div className="max-h-96 overflow-y-auto p-1">
                    <TooltipProvider>
                      <DropdownMenuRadioGroup
                        className="grid grid-cols-7 gap-1"
                        onValueChange={setCustomProviderIcon}
                        value={customProviderIcon}
                      >
                        {visibleCustomProviderIcons.map(({ id, label, preview }) => (
                          <Tooltip key={id}>
                            <TooltipTrigger asChild>
                              <DropdownMenuRadioItem
                                aria-label={label}
                                className="size-12 justify-center p-0 data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground *:data-[slot=dropdown-menu-radio-item-indicator]:hidden"
                                value={id}
                              >
                                {preview}
                              </DropdownMenuRadioItem>
                            </TooltipTrigger>
                            <TooltipContent>{label}</TooltipContent>
                          </Tooltip>
                        ))}
                      </DropdownMenuRadioGroup>
                    </TooltipProvider>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </fieldset>
            <label className="flex flex-col gap-2 text-sm" htmlFor="custom-provider-base-url">
              <span>Base URL</span>
              <Input
                id="custom-provider-base-url"
                className="font-mono"
                onChange={(event) => setCustomProviderBaseUrl(event.target.value)}
                placeholder="https://api.example.com/v1"
                type="url"
                value={customProviderBaseUrl}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm" htmlFor="custom-provider-api-key">
              <span>API key (optional)</span>
              <Input
                autoComplete="off"
                className="font-mono"
                id="custom-provider-api-key"
                onChange={(event) => setCustomProviderApiKey(event.target.value)}
                placeholder="your-api-key"
                type="password"
                value={customProviderApiKey}
              />
            </label>
            <fieldset aria-label="API format" className="space-y-1">
              <legend className="text-sm">API format</legend>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label={selectedCustomProviderApiFormat.label}
                    className="w-fit justify-between"
                    type="button"
                    variant="outline"
                  >
                    {selectedCustomProviderApiFormat.label}
                    <ChevronDownIcon aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-max max-w-[calc(100vw-4rem)]">
                  <DropdownMenuRadioGroup
                    onValueChange={setApiFormat}
                    value={customProviderApiFormat}
                  >
                    {customProviderApiFormats.map(({ label, value }) => (
                      <DropdownMenuRadioItem key={value} value={value}>
                        {label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </fieldset>
            {customProviderApiFormat === 'openai-compatible' ? (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <label className="text-sm" htmlFor="custom-provider-max-completion-tokens">
                    Use max_completion_tokens
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Enable for OpenAI models that require max_completion_tokens.
                  </p>
                </div>
                <Toggle
                  aria-label="Use max_completion_tokens"
                  checked={usesMaxCompletionTokens}
                  id="custom-provider-max-completion-tokens"
                  onCheckedChange={setUsesMaxCompletionTokens}
                />
              </div>
            ) : null}
            <label className="flex flex-col gap-2 text-sm" htmlFor="custom-provider-headers">
              <span>Custom headers (JSON)</span>
              <Textarea
                className="min-h-24 font-mono"
                id="custom-provider-headers"
                onChange={(event) => setCustomProviderHeaders(event.target.value)}
                placeholder={'{\n  "User-Agent": "Mico"\n}'}
                spellCheck={false}
                value={customProviderHeaders}
              />
            </label>
            {customProviderError ? (
              <p className="text-sm text-destructive" role="alert">
                {customProviderError}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
            Cancel
          </Button>
          <Button
            disabled={!customProviderName.trim() || !customProviderBaseUrl.trim()}
            onClick={() => void submitCustomProvider()}
            type="button"
          >
            Add Provider
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { CustomProviderDialog }
