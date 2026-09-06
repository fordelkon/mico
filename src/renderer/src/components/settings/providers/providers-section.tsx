import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  IconMenuButton,
  IconTooltipButton,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Textarea,
  Toggle
} from '@mico/ui'
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleXIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  LoaderCircleIcon,
  SearchIcon,
  Trash2Icon,
  ZapIcon
} from 'lucide-react'
import * as React from 'react'
import type {
  CustomProvider,
  ProviderConfiguration as ProviderConnection
} from '@shared/data/schemas/provider'

import { useProviderLibrary } from './provider-library'
import type { ProviderId } from './providers-sidebar'
import { sortByEnabledOrder } from '@renderer/utils/enabled-order'

function toCustomProviderConfiguration(provider: CustomProvider): ProviderConnection {
  switch (provider.apiFormat) {
    case 'openai-compatible': {
      const configuration: Extract<ProviderConnection, { provider: 'openai-compatible' }> = {
        provider: 'openai-compatible',
        baseUrl: provider.baseUrl,
        headers: provider.headers,
        useMaxCompletionTokens: provider.useMaxCompletionTokens
      }
      if (provider.apiKey) configuration.apiKey = provider.apiKey
      return configuration
    }
    case 'openai-responses': {
      const configuration: Extract<ProviderConnection, { provider: 'openai-responses' }> = {
        provider: 'openai-responses',
        baseUrl: provider.baseUrl,
        headers: provider.headers
      }
      if (provider.apiKey) configuration.apiKey = provider.apiKey
      return configuration
    }
    case 'anthropic-compatible': {
      const configuration: Extract<ProviderConnection, { provider: 'anthropic-compatible' }> = {
        provider: 'anthropic-compatible',
        baseUrl: provider.baseUrl,
        headers: provider.headers
      }
      if (provider.apiKey) configuration.apiKey = provider.apiKey
      return configuration
    }
  }
}

function ProvidersSection({
  onCustomProviderRemoved,
  providerId
}: {
  onCustomProviderRemoved: (providerId: ProviderId) => void
  providerId: ProviderId
}): React.JSX.Element {
  const {
    flushConfiguration,
    library,
    removeCustomProvider,
    syncModels,
    toggleModel,
    updateConfiguration,
    updateCustomProvider
  } = useProviderLibrary()
  const [isApiKeyVisible, setIsApiKeyVisible] = React.useState(false)
  const [hasFetchedModels, setHasFetchedModels] = React.useState(false)
  const [isFetchingModels, setIsFetchingModels] = React.useState(false)
  const [isTestingModel, setIsTestingModel] = React.useState(false)
  const [isTestModelMenuOpen, setIsTestModelMenuOpen] = React.useState(false)
  const [testState, setTestState] = React.useState<'error' | 'idle' | 'success' | 'testing'>('idle')
  const [modelsSearch, setModelsSearch] = React.useState('')
  const [testModelSearch, setTestModelSearch] = React.useState('')
  const [customProviderHeadersDraft, setCustomProviderHeadersDraft] = React.useState<{
    providerId: ProviderId
    value: string
  } | null>(null)
  const [customProviderDraft, setCustomProviderDraft] = React.useState<{
    providerId: ProviderId
    values: Partial<Omit<CustomProvider, 'id'>>
  } | null>(null)
  const customProviderDraftRef = React.useRef<{
    providerId: ProviderId
    values: Partial<Omit<CustomProvider, 'id'>>
  } | null>(null)
  const customProviderDraftVersion = React.useRef(0)
  const customProviderSaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const testModelSearchRef = React.useRef<HTMLInputElement>(null)
  const [status, setStatus] = React.useState<{ kind: 'error' | 'success'; message: string } | null>(
    null
  )
  const customProvider = library.customProviders.find(({ id }) => id === providerId)
  const builtInProviderId = providerId === 'ollama' ? 'ollama' : 'lm-studio'
  const providerLabel = customProvider?.name ?? (providerId === 'ollama' ? 'Ollama' : 'LM Studio')
  const configuration = library.configurations[providerId] ?? {
    apiKey: '',
    baseUrl: 'http://localhost:1234',
    enabled: false
  }
  const models = library.models.filter((model) => model.providerId === providerId)
  const hasModels = hasFetchedModels || models.length > 0
  const filteredModels = models.filter((model) =>
    model.name.toLowerCase().includes(modelsSearch.toLowerCase())
  )
  const filteredTestModels = models.filter((model) =>
    model.name.toLowerCase().includes(testModelSearch.toLowerCase())
  )

  const customProviderHeaders =
    customProviderHeadersDraft?.providerId === providerId
      ? customProviderHeadersDraft.value
      : customProvider
        ? Object.keys(customProvider.headers).length === 0
          ? ''
          : JSON.stringify(customProvider.headers, null, 2)
        : ''
  const customProviderValues =
    customProviderDraft?.providerId === providerId && customProvider
      ? { ...customProvider, ...customProviderDraft.values }
      : customProvider

  const customProviderConfiguration = customProviderValues
    ? toCustomProviderConfiguration(customProviderValues)
    : undefined
  const providerConfiguration: ProviderConnection =
    customProviderConfiguration ??
    (builtInProviderId === 'lm-studio' && configuration.apiKey.trim()
      ? {
          provider: builtInProviderId,
          baseUrl: configuration.baseUrl,
          apiKey: configuration.apiKey
        }
      : { provider: builtInProviderId, baseUrl: configuration.baseUrl })
  const fetchModels = async (): Promise<void> => {
    setIsFetchingModels(true)
    setStatus(null)
    setTestState('idle')

    try {
      const discoveredModels = await window.api.providers.discoverModels(providerConfiguration)
      await syncModels(providerId, discoveredModels)
      setHasFetchedModels(true)
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'The provider returned an unknown error.'
      })
    } finally {
      setIsFetchingModels(false)
    }
  }
  const testModel = async (modelId: string): Promise<void> => {
    setIsTestingModel(true)
    setStatus(null)
    setTestState('testing')

    try {
      await window.api.providers.testModel({ configuration: providerConfiguration, modelId })
      setStatus({ kind: 'success', message: `${modelId} is ready to use.` })
      setTestState('success')
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'The provider returned an unknown error.'
      })
      setTestState('error')
    } finally {
      setIsTestingModel(false)
    }
  }
  const deleteCustomProvider = async (): Promise<void> => {
    if (!customProvider) return

    try {
      await removeCustomProvider(customProvider.id)
      onCustomProviderRemoved(customProvider.id)
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Unable to delete the custom provider.'
      })
    }
  }
  const editCustomProvider = (updates: Partial<Omit<CustomProvider, 'id'>>): void => {
    const current = customProviderDraftRef.current
    const next = {
      providerId,
      values:
        current?.providerId === providerId ? { ...current.values, ...updates } : { ...updates }
    }
    customProviderDraftRef.current = next
    customProviderDraftVersion.current += 1
    setCustomProviderDraft(next)
  }
  const saveCustomProvider = (updates: Partial<Omit<CustomProvider, 'id'>> = {}): void => {
    if (!customProvider) return

    if (customProviderSaveTimer.current) {
      clearTimeout(customProviderSaveTimer.current)
      customProviderSaveTimer.current = null
    }

    const draft =
      customProviderDraftRef.current?.providerId === providerId
        ? customProviderDraftRef.current.values
        : {}
    const apiKey =
      draft.apiKey === undefined ? customProvider.apiKey : draft.apiKey.trim() || undefined
    const provider = { ...customProvider, ...draft, ...updates, apiKey }
    const draftVersion = customProviderDraftVersion.current

    void updateCustomProvider(provider).then(
      () => {
        if (customProviderDraftVersion.current !== draftVersion) return
        customProviderDraftRef.current = null
        setCustomProviderDraft(null)
      },
      (error) => {
        setStatus({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Unable to update the custom provider.'
        })
      }
    )
  }
  const scheduleCustomProviderSave = (): void => {
    if (customProviderSaveTimer.current) clearTimeout(customProviderSaveTimer.current)
    customProviderSaveTimer.current = setTimeout(() => saveCustomProvider(), 150)
  }

  React.useEffect(
    () => () => {
      if (customProviderSaveTimer.current) clearTimeout(customProviderSaveTimer.current)
    },
    []
  )

  React.useEffect(() => {
    const animationFrame = isTestModelMenuOpen
      ? requestAnimationFrame(() => testModelSearchRef.current?.focus())
      : null

    return () => {
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame)
      }
    }
  }, [isTestModelMenuOpen])

  return (
    <main
      aria-label="Provider configuration"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-primary shadow-sm"
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-text-primary">{providerLabel}</h2>
            <p className="mt-1 text-sm text-text-secondary">
              {customProvider
                ? `Use the configured ${customProvider.apiFormat} endpoint.`
                : providerId === 'ollama'
                  ? 'Run open-source LLMs locally with Ollama.'
                  : 'Run LLMs locally with LM Studio.'}
            </p>
            {status ? (
              <p
                className={
                  status.kind === 'error'
                    ? 'mt-2 flex items-center gap-1.5 text-sm text-destructive'
                    : 'mt-2 flex items-center gap-1.5 text-sm text-emerald-600'
                }
                role="status"
              >
                {status.kind === 'success' ? (
                  <CheckCircle2Icon aria-hidden="true" className="size-4" />
                ) : null}
                {status.message}
              </p>
            ) : null}
          </div>
          <div className="flex h-8 items-center gap-3">
            {customProvider ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    aria-label={`Delete ${providerLabel}`}
                    size="icon-sm"
                    title={`Delete ${providerLabel}`}
                    type="button"
                    variant="outline"
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {providerLabel}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes the provider and its fetched models from Mico.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => void deleteCustomProvider()}
                      variant="destructive"
                    >
                      Delete provider
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
            {configuration.enabled ? (
              <IconMenuButton
                className="h-8 w-12 gap-1 px-1.5"
                disabled={!hasModels}
                icon={
                  <>
                    {testState === 'testing' ? (
                      <LoaderCircleIcon
                        aria-label={`Testing ${providerLabel} model`}
                        className="animate-spin"
                      />
                    ) : testState === 'success' ? (
                      <CheckCircle2Icon
                        aria-label={`${providerLabel} model test succeeded`}
                        className="text-emerald-600"
                      />
                    ) : testState === 'error' ? (
                      <CircleXIcon
                        aria-label={`${providerLabel} model test failed`}
                        className="text-destructive"
                      />
                    ) : (
                      <ZapIcon aria-hidden="true" />
                    )}
                    <ChevronDownIcon aria-hidden="true" className="size-3" />
                  </>
                }
                menuAlign="end"
                menuContentClassName="w-72"
                label={`Test ${providerLabel} model`}
                onOpenChange={setIsTestModelMenuOpen}
                variant="outline"
              >
                <div>
                  <div className="p-1 pb-0">
                    <InputGroup className="h-8! rounded-lg! border-input/30 bg-input/30 shadow-none! *:data-[slot=input-group-addon]:pl-2!">
                      <InputGroupInput
                        aria-label={`Search ${providerLabel} models`}
                        onChange={(event) => setTestModelSearch(event.target.value)}
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
                        placeholder="Search models"
                        ref={testModelSearchRef}
                        value={testModelSearch}
                      />
                      <InputGroupAddon>
                        <SearchIcon aria-hidden="true" className="size-4 shrink-0 opacity-50" />
                      </InputGroupAddon>
                    </InputGroup>
                  </div>
                  <div className="max-h-56 overflow-y-auto p-1">
                    {!hasModels ? (
                      <p className="py-6 text-center text-sm text-text-secondary">
                        Fetch models before testing.
                      </p>
                    ) : filteredTestModels.length === 0 ? (
                      <p className="py-6 text-center text-sm text-text-secondary">
                        No models found.
                      </p>
                    ) : (
                      filteredTestModels.map((model) => (
                        <DropdownMenuItem
                          className="rounded-sm px-2 py-1.5"
                          disabled={isTestingModel}
                          key={model.id}
                          onSelect={() => void testModel(model.modelId)}
                        >
                          {model.name}
                        </DropdownMenuItem>
                      ))
                    )}
                  </div>
                </div>
              </IconMenuButton>
            ) : null}
            <Toggle
              aria-label={`Enable ${providerLabel}`}
              checked={configuration.enabled}
              onCheckedChange={(enabled) =>
                updateConfiguration(providerId, { ...configuration, enabled }, { immediate: true })
              }
            />
          </div>
        </header>
        <div className="mt-8 space-y-6">
          {!customProvider ? (
            <section aria-labelledby="getting-started-heading" className="space-y-1">
              <h3 className="text-sm font-medium" id="getting-started-heading">
                Getting Started:
              </h3>
              <p className="text-sm text-text-secondary">
                {providerId === 'ollama'
                  ? 'Make sure Ollama is installed and running locally.'
                  : 'Make sure LM Studio is installed and running locally.'}
              </p>
              <div className="pt-1 text-sm text-text-secondary">
                <p>
                  Install:{' '}
                  <a
                    className="text-brand underline-offset-2 hover:underline focus-visible:underline"
                    href={
                      providerId === 'ollama'
                        ? 'https://ollama.com/download'
                        : 'https://lmstudio.ai'
                    }
                    rel="noreferrer"
                    target="_blank"
                  >
                    {providerId === 'ollama' ? 'ollama.com/download' : 'lmstudio.ai'}
                  </a>
                </p>
                {providerId === 'ollama' ? (
                  <>
                    <p>
                      Pull a model:{' '}
                      <code className="font-mono text-text-primary">ollama pull llama3.2</code>
                    </p>
                    <p>
                      Run: <code className="font-mono text-text-primary">ollama serve</code>
                    </p>
                  </>
                ) : (
                  <>
                    <p>Download a model from the Model Search tab.</p>
                    <p>Run: Start the local server from the Developer tab.</p>
                  </>
                )}
              </div>
            </section>
          ) : null}
          {customProvider ? (
            <section aria-labelledby="provider-details-heading" className="space-y-3">
              <h3 className="font-medium" id="provider-details-heading">
                Provider details
              </h3>
              <label className="flex flex-col gap-2 text-sm" htmlFor={`${providerId}-name`}>
                <span>Provider name</span>
                <Input
                  id={`${providerId}-name`}
                  onBlur={() => saveCustomProvider()}
                  onChange={(event) => {
                    editCustomProvider({ name: event.target.value })
                    scheduleCustomProviderSave()
                  }}
                  value={customProviderValues?.name ?? ''}
                />
              </label>
            </section>
          ) : null}
          <section aria-labelledby="connection-heading" className="space-y-3">
            <h3 className="font-medium" id="connection-heading">
              Connection
            </h3>
            <label className="flex flex-col gap-2 text-sm" htmlFor={`${providerId}-base-url`}>
              <span>Base URL</span>
              <Input
                className="font-mono"
                id={`${providerId}-base-url`}
                onChange={(event) => {
                  if (customProvider) {
                    editCustomProvider({ baseUrl: event.target.value })
                    scheduleCustomProviderSave()
                  } else
                    updateConfiguration(providerId, {
                      ...configuration,
                      baseUrl: event.target.value
                    })
                }}
                onBlur={() => {
                  if (customProvider) saveCustomProvider()
                  else flushConfiguration(providerId)
                }}
                value={customProviderValues?.baseUrl ?? configuration.baseUrl}
              />
            </label>
            {providerId === 'lm-studio' || customProvider ? (
              <label className="flex flex-col gap-2 text-sm" htmlFor={`${providerId}-api-key`}>
                <span>API Key (Optional)</span>
                <div className="flex gap-2">
                  <Input
                    className="font-mono"
                    id={`${providerId}-api-key`}
                    onChange={(event) => {
                      if (customProvider) {
                        editCustomProvider({ apiKey: event.target.value })
                        scheduleCustomProviderSave()
                      } else
                        updateConfiguration(providerId, {
                          ...configuration,
                          apiKey: event.target.value
                        })
                    }}
                    type={isApiKeyVisible ? 'text' : 'password'}
                    onBlur={() => {
                      if (customProvider) saveCustomProvider()
                      else flushConfiguration(providerId)
                    }}
                    value={customProviderValues?.apiKey ?? configuration.apiKey}
                  />
                  <IconTooltipButton
                    icon={
                      isApiKeyVisible ? (
                        <EyeOffIcon aria-hidden="true" />
                      ) : (
                        <EyeIcon aria-hidden="true" />
                      )
                    }
                    label={isApiKeyVisible ? 'Hide API key' : 'Show API key'}
                    onClick={() => setIsApiKeyVisible((visible) => !visible)}
                    variant="outline"
                  />
                </div>
              </label>
            ) : null}
          </section>
          {customProvider ? (
            <section aria-labelledby="custom-connection-heading" className="space-y-3">
              <h3 className="font-medium" id="custom-connection-heading">
                Custom connection settings
              </h3>
              <fieldset aria-label="API format" className="space-y-1">
                <legend className="text-sm">API format</legend>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button className="w-fit" type="button" variant="outline">
                      {customProvider.apiFormat === 'openai-compatible'
                        ? 'Chat Completions (/chat/completions)'
                        : customProvider.apiFormat === 'openai-responses'
                          ? 'Responses (/responses)'
                          : 'Anthropic Messages (v1/messages)'}
                      <ChevronDownIcon aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-max max-w-[calc(100vw-4rem)]">
                    <DropdownMenuRadioGroup
                      onValueChange={(apiFormat) => {
                        if (
                          apiFormat === 'openai-compatible' ||
                          apiFormat === 'openai-responses' ||
                          apiFormat === 'anthropic-compatible'
                        ) {
                          saveCustomProvider({
                            apiFormat,
                            useMaxCompletionTokens:
                              apiFormat === 'openai-compatible'
                                ? customProvider.useMaxCompletionTokens
                                : false
                          })
                        }
                      }}
                      value={customProvider.apiFormat}
                    >
                      <DropdownMenuRadioItem value="openai-compatible">
                        Chat Completions (/chat/completions)
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="openai-responses">
                        Responses (/responses)
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="anthropic-compatible">
                        Anthropic Messages (v1/messages)
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </fieldset>
              {customProvider.apiFormat === 'openai-compatible' ? (
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <label className="text-sm" htmlFor={`${providerId}-max-completion-tokens`}>
                      Use max_completion_tokens
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Enable for OpenAI models that require max_completion_tokens.
                    </p>
                  </div>
                  <Toggle
                    aria-label="Use max_completion_tokens"
                    checked={customProvider.useMaxCompletionTokens}
                    id={`${providerId}-max-completion-tokens`}
                    onCheckedChange={(useMaxCompletionTokens) =>
                      saveCustomProvider({ useMaxCompletionTokens })
                    }
                  />
                </div>
              ) : null}
              <label className="flex flex-col gap-2 text-sm" htmlFor={`${providerId}-headers`}>
                <span>Custom headers (JSON)</span>
                <Textarea
                  className="min-h-24 font-mono"
                  id={`${providerId}-headers`}
                  onBlur={() => {
                    try {
                      saveCustomProvider({
                        headers: customProviderHeaders.trim()
                          ? JSON.parse(customProviderHeaders)
                          : {}
                      })
                    } catch {
                      setStatus({ kind: 'error', message: 'Custom headers must be valid JSON.' })
                    }
                  }}
                  onChange={(event) => {
                    setCustomProviderHeadersDraft({ providerId, value: event.target.value })
                    try {
                      editCustomProvider({
                        headers: event.target.value.trim() ? JSON.parse(event.target.value) : {}
                      })
                      scheduleCustomProviderSave()
                    } catch {
                      if (customProviderSaveTimer.current) {
                        clearTimeout(customProviderSaveTimer.current)
                        customProviderSaveTimer.current = null
                      }
                      // Keep the invalid draft local until the user corrects it.
                    }
                  }}
                  placeholder={'{\n  "User-Agent": "Mico"\n}'}
                  spellCheck={false}
                  value={customProviderHeaders}
                />
              </label>
            </section>
          ) : null}
          <section aria-labelledby="models-heading" className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium" id="models-heading">
                  Models
                </h3>
              </div>
              <Button
                aria-label={`Fetch ${providerLabel} models`}
                disabled={isFetchingModels}
                onClick={() => void fetchModels()}
                size="sm"
                variant="outline"
              >
                <DownloadIcon aria-hidden="true" />
                {isFetchingModels ? 'Fetching' : 'Fetch'}
              </Button>
            </div>
            <InputGroup className="rounded-lg border-input/30 bg-input/30 shadow-none">
              <InputGroupInput
                aria-label={`Search ${providerLabel} models`}
                disabled={!hasModels}
                onChange={(event) => setModelsSearch(event.target.value)}
                placeholder="Search models"
                type="search"
                value={modelsSearch}
              />
              <InputGroupAddon>
                <SearchIcon aria-hidden="true" className="size-4 shrink-0 opacity-50" />
              </InputGroupAddon>
            </InputGroup>
            <div
              aria-label={`${providerLabel} fetched models`}
              className="max-h-48 overflow-y-auto rounded-md border border-border-subtle"
            >
              {hasModels ? (
                filteredModels.length === 0 ? (
                  <p className="px-3 py-8 text-center text-sm text-text-secondary">
                    No models match your search.
                  </p>
                ) : (
                  sortByEnabledOrder(
                    filteredModels,
                    library.enabledModelIds,
                    (model) => model.id
                  ).map((model) => (
                    <div
                      className="flex items-center justify-between border-b border-border-subtle px-3 py-2.5 last:border-b-0"
                      key={model.id}
                    >
                      <span className="font-mono text-sm">{model.name}</span>
                      <Toggle
                        aria-label={`Enable ${model.name}`}
                        checked={model.enabled}
                        onCheckedChange={(enabled) => void toggleModel(model, enabled)}
                      />
                    </div>
                  ))
                )
              ) : (
                <p className="px-3 py-8 text-center text-sm text-text-secondary">
                  Fetch models to get started.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

export { ProvidersSection }
