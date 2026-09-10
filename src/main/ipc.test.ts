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
    getThemeState: vi.fn(),
    setAppearancePreference: vi.fn(),
    setThemePreferences: vi.fn()
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
  const session = {
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    listSessions: vi.fn(),
    loadSession: vi.fn(),
    renameSession: vi.fn()
  }

  registerIpc(
    { mainWindow, preference, chat, provider, session },
    {
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      // SAFETY: The chat handlers only use this value to establish a trusted calling window.
      getWindow: () => Object.create(null) as BrowserWindow
    }
  )

  return { chat, handlers, mainWindow, preference, provider, session }
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

describe('registerIpc session handlers', () => {
  it('returns session summaries only to a trusted renderer', () => {
    const { handlers, mainWindow, session } = createHarness()
    const trusted = createEvent({ id: 42 })
    const untrusted = createEvent({ id: 43 })
    const summaries = [
      {
        id: 'session-1',
        title: 'Saved chat',
        defaultProfile: null,
        createdAt: 1,
        updatedAt: 2,
        lastActivityAt: 2
      }
    ]
    session.listSessions.mockReturnValue(summaries)
    mainWindow.isTrustedRendererUrl.mockReturnValueOnce(true).mockReturnValueOnce(false)

    expect(handlers.get(IpcChannel.Sessions_List)?.(trusted.event)).toEqual(summaries)
    expect(() => handlers.get(IpcChannel.Sessions_List)?.(untrusted.event)).toThrow('Untrusted')
  })

  it('validates and delegates session mutations for a trusted renderer', () => {
    const { handlers, session } = createHarness()
    const { event } = createEvent({ id: 42 })
    const summary = {
      id: 'session-1',
      title: 'Saved chat',
      defaultProfile: null,
      createdAt: 1,
      updatedAt: 2,
      lastActivityAt: 2
    }
    const persisted = { ...summary, messages: [] }
    session.createSession.mockReturnValue(summary)
    session.loadSession.mockReturnValue(persisted)
    session.renameSession.mockReturnValue(summary)

    expect(handlers.get(IpcChannel.Sessions_Create)?.(event, { title: 'Saved chat' })).toEqual(
      summary
    )
    expect(handlers.get(IpcChannel.Sessions_Load)?.(event, 'session-1')).toEqual(persisted)
    expect(handlers.get(IpcChannel.Sessions_Delete)?.(event, 'session-1')).toBeUndefined()
    expect(
      handlers.get(IpcChannel.Sessions_Rename)?.(event, {
        sessionId: 'session-1',
        title: 'Renamed chat'
      })
    ).toEqual(summary)
    expect(session.createSession).toHaveBeenCalledWith({
      title: 'Saved chat',
      defaultProfile: null
    })
    expect(session.loadSession).toHaveBeenCalledWith('session-1')
    expect(session.deleteSession).toHaveBeenCalledWith('session-1')
    expect(session.renameSession).toHaveBeenCalledWith('session-1', 'Renamed chat')
  })

  it('rejects invalid session input before delegation', () => {
    const { handlers, session } = createHarness()
    const { event } = createEvent({ id: 42 })

    expect(() => handlers.get(IpcChannel.Sessions_Create)?.(event, { title: '' })).toThrow(
      'Invalid session title'
    )
    expect(() => handlers.get(IpcChannel.Sessions_Load)?.(event, '')).toThrow('Invalid session ID')
    expect(() => handlers.get(IpcChannel.Sessions_Delete)?.(event, '')).toThrow(
      'Invalid session ID'
    )
    expect(() =>
      handlers.get(IpcChannel.Sessions_Rename)?.(event, { sessionId: '', title: '' })
    ).toThrow('Invalid session rename')
    expect(session.createSession).not.toHaveBeenCalled()
    expect(session.loadSession).not.toHaveBeenCalled()
    expect(session.deleteSession).not.toHaveBeenCalled()
    expect(session.renameSession).not.toHaveBeenCalled()
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

describe('registerIpc theme handlers', () => {
  const themePreferences = {
    appearancePreference: 'system' as const,
    codeThemeDark: 'dracula' as const,
    codeThemeLight: 'github-light' as const,
    themePresetDark: 'tokyo-night' as const,
    themePresetLight: 'one-nord-light' as const
  }
  const themeState = {
    ...themePreferences,
    activeThemePreset: 'one-nord-light' as const,
    appearance: 'light' as const,
    shikiThemes: { dark: 'dracula', light: 'github-light' }
  }

  it('returns the complete theme state only to a trusted renderer', () => {
    const { handlers, mainWindow, preference } = createHarness()
    preference.getThemeState.mockReturnValue(themeState)
    const trusted = createEvent({ id: 42 })
    const untrusted = createEvent({ id: 43, trusted: false })
    mainWindow.isTrustedRendererUrl.mockReturnValueOnce(true).mockReturnValueOnce(false)

    expect(handlers.get(IpcChannel.Appearance_GetThemeState)?.(trusted.event)).toEqual(themeState)
    expect(() => handlers.get(IpcChannel.Appearance_GetThemeState)?.(untrusted.event)).toThrow(
      'Untrusted'
    )
  })

  it('validates and persists trusted theme preferences', async () => {
    const { handlers, preference } = createHarness()
    preference.setThemePreferences.mockResolvedValue(themeState)
    const { event } = createEvent({ id: 42 })

    await expect(
      handlers.get(IpcChannel.Appearance_SetThemePreferences)?.(event, themePreferences)
    ).resolves.toEqual(themeState)
    expect(preference.setThemePreferences).toHaveBeenCalledWith(themePreferences)

    await expect(
      handlers.get(IpcChannel.Appearance_SetThemePreferences)?.(event, {
        ...themePreferences,
        codeThemeLight: 'unsupported'
      })
    ).rejects.toThrow('Invalid theme preferences')
    expect(preference.setThemePreferences).toHaveBeenCalledOnce()
  })
})
