import type { ProviderLibrary } from '@shared/data/schemas/provider'
import type { ProvidersAPI } from '@shared/ipc/schemas/providers'
import type { WindowControlsAPI } from '@shared/ipc/schemas/window-controls'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ProviderLibraryProvider,
  useProviderLibraryActions,
  useProviderLibraryState
} from './provider-library'

function ActionOnlyConsumer({ onRender }: { onRender: () => void }): React.JSX.Element {
  onRender()
  const { selectProvider } = useProviderLibraryActions()
  return <button onClick={() => void selectProvider('ollama')}>Select provider</button>
}

function SelectedProviderConsumer(): React.JSX.Element {
  const { library } = useProviderLibraryState()
  return <output>{library.selectedProviderId ?? 'none'}</output>
}

const provider = {
  apiFormat: 'openai-compatible' as const,
  baseUrl: 'https://api.example.com/v1',
  enabled: true,
  headers: {},
  icon: 'cloud',
  id: 'example-ai',
  name: 'Example AI'
}
const existingModel = {
  displayName: 'Existing model',
  enabled: true,
  id: 'existing-model',
  modelId: 'existing',
  provider: provider.id
}
const addedModel = {
  displayName: 'New model',
  enabled: false,
  id: 'new-model',
  modelId: 'new',
  provider: provider.id
}

afterEach(() => vi.useRealTimers())

describe('ProviderLibraryProvider', () => {
  it('user selects a provider when an action-only consumer is mounted, then that consumer does not render again', async () => {
    const user = userEvent.setup()
    const onRender = vi.fn<() => void>()
    const getLibrary = vi.fn<ProvidersAPI['getLibrary']>(async () => ({
      configurations: [{ provider: 'ollama', baseUrl: 'http://localhost:11434' }],
      customProviders: [],
      enabledProviderIds: ['ollama'],
      models: [],
      selectedModelId: null,
      selectedProviderId: null
    }))
    const saveLibrary = vi.fn<ProvidersAPI['saveLibrary']>(async (snapshot) => snapshot)
    const onProviderDraftFlush = vi.fn<WindowControlsAPI['onProviderDraftFlush']>(
      () => () => undefined
    )
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { providers: { getLibrary, saveLibrary }, windowControls: { onProviderDraftFlush } }
    })
    render(
      <ProviderLibraryProvider>
        <ActionOnlyConsumer onRender={onRender} />
        <SelectedProviderConsumer />
      </ProviderLibraryProvider>
    )

    await waitFor(() => expect(getLibrary).toHaveBeenCalled())
    expect(onRender).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Select provider' }))

    expect(screen.getByText('ollama')).toBeVisible()
    expect(onRender).toHaveBeenCalledTimes(1)
  })

  it('user toggles during model addition when both start together, then both changes persist', async () => {
    const initial: ProviderLibrary = {
      configurations: [{ provider: 'ollama', baseUrl: 'http://localhost:11434' }],
      customProviders: [provider],
      enabledProviderIds: [provider.id],
      models: [existingModel],
      selectedModelId: existingModel.id,
      selectedProviderId: provider.id
    }
    const refreshStarted = Promise.withResolvers<void>()
    const refreshResponse = Promise.withResolvers<ProviderLibrary>()
    const getLibrary = vi.fn<ProvidersAPI['getLibrary']>()
    getLibrary.mockResolvedValueOnce(initial)
    getLibrary.mockImplementationOnce(() => {
      refreshStarted.resolve()
      return refreshResponse.promise
    })
    const saveLibrary = vi.fn<ProvidersAPI['saveLibrary']>(async (snapshot) => snapshot)
    const addModel = vi.fn<ProvidersAPI['addModel']>(async () => addedModel)
    const onProviderDraftFlush = vi.fn<WindowControlsAPI['onProviderDraftFlush']>(
      () => () => undefined
    )
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        providers: { addModel, getLibrary, saveLibrary },
        windowControls: { onProviderDraftFlush }
      }
    })
    const { result } = renderHook(
      () => ({ actions: useProviderLibraryActions(), state: useProviderLibraryState() }),
      { wrapper: ProviderLibraryProvider }
    )
    await waitFor(() => expect(result.current.state.isLoaded).toBe(true))
    vi.useFakeTimers()
    await act(async () => {
      const adding = result.current.actions.addModel({ provider: provider.id, modelId: 'new' })
      const toggling = result.current.actions.toggleModel(
        result.current.state.library.models[0],
        false
      )
      await refreshStarted.promise
      refreshResponse.resolve({ ...initial, models: [addedModel, existingModel] })
      await Promise.all([adding, toggling])
      await result.current.actions.commitProviderDrafts()
    })
    expect(
      result.current.state.library.models.find(({ id }) => id === existingModel.id)?.enabled
    ).toBe(false)
    const saved = saveLibrary.mock.calls.at(-1)?.[0]
    expect(saved?.models.find(({ id }) => id === existingModel.id)?.enabled).toBe(false)
    expect(saved?.models.map(({ id }) => id)).toEqual([addedModel.id, existingModel.id])
  })
  it('user retries after model refresh fails when closing, then the added model persists', async () => {
    const initial: ProviderLibrary = {
      configurations: [{ provider: 'ollama', baseUrl: 'http://localhost:11434' }],
      customProviders: [provider],
      enabledProviderIds: [provider.id],
      models: [existingModel],
      selectedModelId: existingModel.id,
      selectedProviderId: provider.id
    }
    const refreshStarted = Promise.withResolvers<void>()
    const refreshResponse = Promise.withResolvers<ProviderLibrary>()
    const getLibrary = vi.fn<ProvidersAPI['getLibrary']>()
    getLibrary.mockResolvedValueOnce(initial)
    getLibrary.mockImplementationOnce(() => {
      refreshStarted.resolve()
      return refreshResponse.promise
    })
    getLibrary.mockResolvedValue({ ...initial, models: [addedModel, existingModel] })
    const saveLibrary = vi.fn<ProvidersAPI['saveLibrary']>(async (snapshot) => snapshot)
    const addModel = vi.fn<ProvidersAPI['addModel']>(async () => addedModel)
    const onProviderDraftFlush = vi.fn<WindowControlsAPI['onProviderDraftFlush']>(
      () => () => undefined
    )
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        providers: { addModel, getLibrary, saveLibrary },
        windowControls: { onProviderDraftFlush }
      }
    })
    const { result } = renderHook(
      () => ({ actions: useProviderLibraryActions(), state: useProviderLibraryState() }),
      { wrapper: ProviderLibraryProvider }
    )
    await waitFor(() => expect(result.current.state.isLoaded).toBe(true))
    vi.useFakeTimers()
    await act(async () => {
      const updating = result.current.actions.addModel({ provider: provider.id, modelId: 'new' })
      const failed = (async (): Promise<void> => {
        await expect(updating).rejects.toThrow('Read unavailable')
      })()
      await refreshStarted.promise
      result.current.actions.updateCustomProvider(provider.id, { name: 'Latest name' })
      refreshResponse.reject(new Error('Read unavailable'))
      await failed
    })
    expect(saveLibrary).not.toHaveBeenCalled()
    const flush = onProviderDraftFlush.mock.calls.at(-1)?.[0]
    if (!flush) throw new Error('The window close listener must be registered.')
    await act(flush)
    const saved = saveLibrary.mock.calls.at(-1)?.[0]
    expect(saved?.customProviders[0].name).toBe('Latest name')
    expect(saved?.models.map(({ id }) => id)).toEqual([addedModel.id, existingModel.id])
    expect(result.current.state.library.models.map(({ id }) => id)).toEqual([
      addedModel.id,
      existingModel.id
    ])
  })
  it.each(['add', 'sync'] as const)(
    'user edits during delayed model %s when closing, then edits and models persist',
    async (operation) => {
      const initial: ProviderLibrary = {
        configurations: [{ provider: 'ollama', baseUrl: 'http://localhost:11434' }],
        customProviders: [provider],
        enabledProviderIds: [provider.id],
        models: [existingModel],
        selectedModelId: existingModel.id,
        selectedProviderId: provider.id
      }
      const refreshed: ProviderLibrary = {
        ...initial,
        models: operation === 'sync' ? [addedModel] : [addedModel, existingModel],
        selectedModelId: operation === 'sync' ? null : existingModel.id
      }
      const refreshStarted = Promise.withResolvers<void>()
      const refreshResponse = Promise.withResolvers<ProviderLibrary>()
      const getLibrary = vi.fn<ProvidersAPI['getLibrary']>()
      getLibrary.mockResolvedValueOnce(initial)
      getLibrary.mockImplementationOnce(() => {
        refreshStarted.resolve()
        return refreshResponse.promise
      })
      const saveLibrary = vi.fn<ProvidersAPI['saveLibrary']>(async (snapshot) => snapshot)
      const addModel = vi.fn<ProvidersAPI['addModel']>(async () => addedModel)
      const syncModels = vi.fn<ProvidersAPI['syncModels']>(async () => undefined)
      const onProviderDraftFlush = vi.fn<WindowControlsAPI['onProviderDraftFlush']>(
        () => () => undefined
      )
      Object.defineProperty(window, 'api', {
        configurable: true,
        value: {
          providers: { addModel, getLibrary, saveLibrary, syncModels },
          windowControls: { onProviderDraftFlush }
        }
      })
      const { result } = renderHook(
        () => ({ actions: useProviderLibraryActions(), state: useProviderLibraryState() }),
        { wrapper: ProviderLibraryProvider }
      )
      await waitFor(() => expect(result.current.state.isLoaded).toBe(true))
      vi.useFakeTimers()
      await act(async () => {
        const updating =
          operation === 'add'
            ? result.current.actions.addModel({ provider: provider.id, modelId: 'new' })
            : result.current.actions.syncModels(provider.id, [
                { displayName: 'New model', modelId: 'new' }
              ])
        await refreshStarted.promise
        result.current.actions.updateCustomProvider(provider.id, {
          name: 'Latest name',
          apiKey: 'latest-key',
          headers: { 'X-Client': 'latest' }
        })
        result.current.actions.updateConfiguration('ollama', {
          apiKey: '',
          baseUrl: 'http://localhost:22434',
          enabled: true
        })
        const flush = onProviderDraftFlush.mock.calls.at(-1)?.[0]
        if (!flush) throw new Error('The window close listener must be registered.')
        const closing = flush()
        refreshResponse.resolve(refreshed)
        await updating
        await closing
      })
      expect(result.current.state.library.customProviders[0]).toMatchObject({
        name: 'Latest name',
        apiKey: 'latest-key',
        headers: { 'X-Client': 'latest' }
      })
      expect(result.current.state.library.configurations.ollama).toMatchObject({
        baseUrl: 'http://localhost:22434',
        enabled: true
      })
      expect(result.current.state.library.models.map(({ id }) => id)).toEqual(
        operation === 'sync' ? [addedModel.id] : [addedModel.id, existingModel.id]
      )
      expect(result.current.state.library.selectedModelId).toBe(refreshed.selectedModelId)
      const saved = saveLibrary.mock.calls.at(-1)?.[0]
      expect(saved?.customProviders[0].name).toBe('Latest name')
      expect(saved?.models.map(({ id }) => id)).toEqual(refreshed.models.map(({ id }) => id))
      expect(saved?.selectedModelId).toBe(refreshed.selectedModelId)
    }
  )
})
