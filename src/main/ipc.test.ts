import { describe, expect, it, vi } from 'vitest'

import { IpcChannel } from '@shared/IpcChannel'
import type { ChatStreamEvent, ModelReasoningCapabilities } from '@shared/data/schemas/chat'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { registerIpc } from './ipc'

type Handler = Parameters<IpcMain['handle']>[1]

function createHarness() {
  const handlers = new Map<string, Handler>()
  const chat = {
    abort: vi.fn(),
    abortAll: vi.fn(),
    getModelCapabilities: vi.fn(),
    start: vi.fn()
  }
  const mainWindow = {
    close: vi.fn(),
    isFullscreen: vi.fn(),
    isMaximized: vi.fn(),
    isTrustedRendererUrl: vi.fn(() => true),
    maximize: vi.fn(),
    minimize: vi.fn(),
    toggleFullscreen: vi.fn(),
    unmaximize: vi.fn()
  }
  const preference = {
    getAppearancePreference: vi.fn(),
    getResolvedAppearance: vi.fn(),
    setAppearancePreference: vi.fn()
  }
  const provider = {
    addModel: vi.fn(),
    addCustomProvider: vi.fn(),
    updateCustomProvider: vi.fn(),
    discoverModels: vi.fn(),
    getLibrary: vi.fn(),
    importModel: vi.fn(),
    setModelEnabled: vi.fn(),
    syncModels: vi.fn(),
    removeCustomProvider: vi.fn(),
    removeModel: vi.fn(),
    saveConfiguration: vi.fn(),
    saveLibrary: vi.fn(),
    selectModel: vi.fn(),
    selectProvider: vi.fn(),
    testModel: vi.fn()
  }

  registerIpc(
    { mainWindow, preference, chat, provider },
    {
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      // SAFETY: The chat handlers only use this value to establish a trusted calling window.
      getWindow: () => Object.create(null) as BrowserWindow
    }
  )

  return { chat, handlers, mainWindow, provider }
}

function createEvent({
  id,
  frameDestroyed = false,
  isMainFrame = true,
  trusted = true
}: {
  id: number
  frameDestroyed?: boolean
  isMainFrame?: boolean
  trusted?: boolean
}) {
  const destroyedListeners: Array<() => void> = []
  const senderFrame = { isDestroyed: vi.fn(() => frameDestroyed) }
  const sender = {
    id,
    mainFrame: senderFrame,
    isDestroyed: vi.fn(() => false),
    once: vi.fn((event: string, listener: () => void) => {
      if (event === 'destroyed') destroyedListeners.push(listener)
    }),
    send: vi.fn()
  }
  const invokingFrame = isMainFrame ? sender.mainFrame : {}

  // SAFETY: The handlers exercise only sender identity, sender frame identity, and fake event methods.
  const event = Object.assign(Object.create(null) as IpcMainInvokeEvent, {
    sender,
    senderFrame: invokingFrame
  })

  return { destroyedListeners, event, sender, trusted }
}

describe('registerIpc chat handlers', () => {
  it('returns capabilities only to a trusted renderer', async () => {
    const { chat, handlers, mainWindow } = createHarness()
    const capabilities: ModelReasoningCapabilities = {
      selectableEfforts: ['medium', 'high'],
      defaultEffort: 'medium'
    }
    chat.getModelCapabilities.mockResolvedValue(capabilities)
    const trusted = createEvent({ id: 42 })
    const untrusted = createEvent({ id: 43, trusted: false })
    mainWindow.isTrustedRendererUrl.mockReturnValueOnce(true).mockReturnValueOnce(false)

    await expect(handlers.get(IpcChannel.Chat_GetCapabilities)?.(trusted.event)).resolves.toEqual(
      capabilities
    )
    expect(chat.getModelCapabilities).toHaveBeenCalledOnce()
    expect(() => handlers.get(IpcChannel.Chat_GetCapabilities)?.(untrusted.event)).toThrow()
  })

  it('starts a trusted request under its sender ID and sends events only to that sender', () => {
    const { chat, handlers } = createHarness()
    const { event, sender } = createEvent({ id: 42 })
    const request = {
      conversationId: 'chat-1',
      requestId: 'request-1',
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }]
    }
    let emit: ((event: ChatStreamEvent) => void) | undefined
    chat.start.mockImplementation((_input, sink) => {
      emit = sink
    })

    handlers.get(IpcChannel.Chat_Start)?.(event, request)
    emit?.({ type: 'finish', requestId: 'request-1' })

    expect(chat.start).toHaveBeenCalledWith({ ownerId: '42', request }, expect.any(Function))
    expect(sender.send).toHaveBeenCalledWith(IpcChannel.Chat_Event, {
      type: 'finish',
      requestId: 'request-1'
    })
  })

  it.each([
    { isMainFrame: false, trusted: true },
    { isMainFrame: true, trusted: false }
  ])('rejects untrusted senders before starting chat', ({ isMainFrame, trusted }) => {
    const { chat, handlers, mainWindow } = createHarness()
    mainWindow.isTrustedRendererUrl.mockReturnValue(trusted)
    const { event } = createEvent({ id: 42, isMainFrame, trusted })

    expect(() =>
      handlers.get(IpcChannel.Chat_Start)?.(event, {
        conversationId: 'chat-1',
        requestId: 'request-1',
        messages: []
      })
    ).toThrow()
    expect(chat.start).not.toHaveBeenCalled()
  })

  it('aborts all runs only when the invoking sender is destroyed', () => {
    const { chat, handlers } = createHarness()
    const first = createEvent({ id: 42 })
    const second = createEvent({ id: 43 })

    handlers.get(IpcChannel.Chat_Start)?.(first.event, {
      conversationId: 'chat-1',
      requestId: 'request-1',
      messages: []
    })
    handlers.get(IpcChannel.Chat_Start)?.(second.event, {
      conversationId: 'chat-1',
      requestId: 'request-1',
      messages: []
    })
    first.destroyedListeners.forEach((listener) => listener())

    expect(chat.abortAll).toHaveBeenCalledWith('42')
    expect(chat.abortAll).not.toHaveBeenCalledWith('43')
  })

  it('stops the owner run instead of sending to a disposed renderer frame', () => {
    const { chat, handlers } = createHarness()
    const { event, sender } = createEvent({ id: 42, frameDestroyed: true })
    let emit: ((event: ChatStreamEvent) => void) | undefined
    chat.start.mockImplementation((_input, sink) => {
      emit = sink
    })

    handlers.get(IpcChannel.Chat_Start)?.(event, {
      conversationId: 'chat-1',
      requestId: 'request-1',
      messages: []
    })
    emit?.({ type: 'finish', requestId: 'request-1' })

    expect(sender.send).not.toHaveBeenCalled()
    expect(chat.abortAll).toHaveBeenCalledWith('42')
  })
})

describe('registerIpc provider handlers', () => {
  it('rejects an untrusted sender before provider discovery', async () => {
    const { handlers, mainWindow, provider } = createHarness()
    const { event } = createEvent({ id: 42, trusted: false })
    mainWindow.isTrustedRendererUrl.mockReturnValue(false)

    expect(() =>
      handlers.get(IpcChannel.Providers_DiscoverModels)?.(event, {
        provider: 'ollama',
        baseUrl: 'http://localhost:11434'
      })
    ).toThrow('Untrusted')
    expect(provider.discoverModels).not.toHaveBeenCalled()
  })

  it('validates and delegates a trusted configuration save', async () => {
    const { handlers, provider } = createHarness()
    const { event } = createEvent({ id: 42 })
    const configuration = { provider: 'ollama' as const, baseUrl: 'http://localhost:11434' }
    provider.saveConfiguration.mockImplementation(async (input) => {
      if (JSON.stringify(input) !== JSON.stringify(configuration)) {
        throw new Error('Provider configuration was not forwarded.')
      }
      return configuration
    })

    await expect(
      handlers.get(IpcChannel.Providers_SaveConfiguration)?.(event, configuration)
    ).resolves.toEqual(configuration)
  })

  it('validates and delegates a trusted provider-library snapshot', async () => {
    const { handlers, provider } = createHarness()
    const { event } = createEvent({ id: 42 })
    const library = {
      configurations: [{ provider: 'ollama' as const, baseUrl: 'http://localhost:11434' }],
      customProviders: [],
      enabledProviderIds: [],
      models: [],
      selectedModelId: null,
      selectedProviderId: null
    }
    provider.saveLibrary.mockResolvedValue(library)

    await expect(handlers.get(IpcChannel.Providers_SaveLibrary)?.(event, library)).resolves.toEqual(
      library
    )
  })

  it('validates and delegates a trusted provider selection', async () => {
    const { handlers, provider } = createHarness()
    const { event } = createEvent({ id: 42 })
    provider.selectProvider.mockImplementation(async (providerId) => {
      if (providerId !== 'ollama') throw new Error('Provider selection was not forwarded.')
      return providerId
    })

    await expect(
      handlers.get(IpcChannel.Providers_SelectProvider)?.(event, 'ollama')
    ).resolves.toEqual('ollama')
  })

  it('rejects an invalid provider selection before delegation', () => {
    const { handlers, provider } = createHarness()
    const { event } = createEvent({ id: 42 })

    expect(() => handlers.get(IpcChannel.Providers_SelectProvider)?.(event, '')).toThrow(
      'Invalid provider ID'
    )
    expect(provider.selectProvider).not.toHaveBeenCalled()
  })
})
