import { describe, expect, it, vi } from 'vitest'

import { IpcChannel } from '@shared/IpcChannel'
import type { ModelReasoningCapabilities } from '@shared/data/schemas/chat'
import type { TurnStreamEvent } from '@shared/ipc/schemas/chat'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { registerIpc } from './ipc'

type Handler = Parameters<IpcMain['handle']>[1]

function createFileHandle(bytes: Uint8Array, maxChunkSize = bytes.byteLength) {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    read: vi.fn(async (buffer: Uint8Array, offset: number, length: number, position: number) => {
      const chunk = bytes.subarray(position, position + Math.min(length, maxChunkSize))
      buffer.set(chunk, offset)
      return { bytesRead: chunk.byteLength }
    })
  }
}

function createHarness() {
  const handlers = new Map<string, Handler>()
  // SAFETY: The test double is only passed through to assert the IPC handler delegates correctly.
  const window = Object.create(null) as BrowserWindow
  const turnExecutor = {
    abortTurn: vi.fn(),
    abortAllTurns: vi.fn(),
    getModelCapabilities: vi.fn(),
    startTurn: vi.fn(),
    updateSessionModelEntry: vi.fn(),
    updateSessionThinkingEffort: vi.fn()
  }
  const mainWindow = {
    close: vi.fn(),
    isFocused: vi.fn(),
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
  const workspace = {
    addProject: vi.fn(),
    archiveProject: vi.fn(),
    getActiveProjectContext: vi.fn(),
    getDefaultWorkspaceContext: vi.fn(() => ({
      kind: 'project' as const,
      projectId: 'default',
      rootPath: '/workspaces/default'
    })),
    getProjectContext: vi.fn(),
    listProjects: vi.fn(),
    renameProject: vi.fn(),
    setDefaultProject: vi.fn()
  }
  const openPath = vi.fn().mockResolvedValue('')
  const pickCodeDocuments = vi.fn().mockResolvedValue({ canceled: true, filePaths: [] })
  const openFile = vi.fn()
  const stat = vi.fn()

  registerIpc(
    { mainWindow, preference, turnExecutor, provider, session, workspace },
    {
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      // SAFETY: The chat handlers only use this value to establish a trusted calling window.
      getWindow: () => window,
      openPath,
      pickDirectory: async () => undefined,
      pickCodeDocuments,
      openFile,
      stat
    }
  )

  return {
    turnExecutor,
    handlers,
    mainWindow,
    preference,
    provider,
    session,
    openPath,
    pickCodeDocuments,
    openFile,
    stat,
    window,
    workspace
  }
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

describe('registerIpc window control handlers', () => {
  it('returns native focus state for the invoking window', () => {
    const { handlers, mainWindow, window } = createHarness()
    const { event } = createEvent({ id: 42 })
    mainWindow.isFocused.mockReturnValue(true)

    expect(handlers.get(IpcChannel.WindowControls_IsFocused)?.(event)).toBe(true)
    expect(mainWindow.isFocused).toHaveBeenCalledWith(window)
  })
})

describe('registerIpc attachment handlers', () => {
  it('returns selected UTF-8 code documents without exposing their paths', async () => {
    const { handlers, openFile, pickCodeDocuments, stat } = createHarness()
    const { event } = createEvent({ id: 42 })
    pickCodeDocuments.mockResolvedValue({ canceled: false, filePaths: ['/tmp/a.ts'] })
    stat.mockResolvedValue({ size: 22 })
    openFile.mockResolvedValue(createFileHandle(new TextEncoder().encode('export const value = 1')))

    await expect(handlers.get(IpcChannel.Attachments_PickCodeDocuments)?.(event)).resolves.toEqual([
      { type: 'document', name: 'a.ts', text: 'export const value = 1' }
    ])
    expect(openFile).toHaveBeenCalledWith('/tmp/a.ts')
  })

  it('rejects unsupported extensions before reading a document', async () => {
    const { handlers, openFile, pickCodeDocuments, stat } = createHarness()
    const { event } = createEvent({ id: 42 })
    pickCodeDocuments.mockResolvedValue({ canceled: false, filePaths: ['/tmp/archive.zip'] })

    await expect(handlers.get(IpcChannel.Attachments_PickCodeDocuments)?.(event)).rejects.toThrow(
      'Only code and text documents can be attached.'
    )
    expect(stat).not.toHaveBeenCalled()
    expect(openFile).not.toHaveBeenCalled()
  })

  it('rejects a file larger than 256 KiB before reading it', async () => {
    const { handlers, openFile, pickCodeDocuments, stat } = createHarness()
    const { event } = createEvent({ id: 42 })
    pickCodeDocuments.mockResolvedValue({ canceled: false, filePaths: ['/tmp/large.ts'] })
    stat.mockResolvedValue({ size: 256 * 1024 + 1 })

    await expect(handlers.get(IpcChannel.Attachments_PickCodeDocuments)?.(event)).rejects.toThrow(
      'larger than 256 KiB'
    )
    expect(openFile).not.toHaveBeenCalled()
  })

  it('rejects documents that are not valid UTF-8', async () => {
    const { handlers, openFile, pickCodeDocuments, stat } = createHarness()
    const { event } = createEvent({ id: 42 })
    pickCodeDocuments.mockResolvedValue({ canceled: false, filePaths: ['/tmp/binary.ts'] })
    stat.mockResolvedValue({ size: 2 })
    openFile.mockResolvedValue(createFileHandle(Uint8Array.from([0xc3, 0x28])))

    await expect(handlers.get(IpcChannel.Attachments_PickCodeDocuments)?.(event)).rejects.toThrow(
      'not valid UTF-8'
    )
  })

  it('rejects a batch larger than 1 MiB', async () => {
    const { handlers, openFile, pickCodeDocuments, stat } = createHarness()
    const { event } = createEvent({ id: 42 })
    const paths = Array.from({ length: 5 }, (_, index) => `/tmp/${index}.ts`)
    pickCodeDocuments.mockResolvedValue({ canceled: false, filePaths: paths })
    stat.mockResolvedValue({ size: 256 * 1024 })
    openFile.mockResolvedValue(createFileHandle(new Uint8Array(256 * 1024)))

    await expect(handlers.get(IpcChannel.Attachments_PickCodeDocuments)?.(event)).rejects.toThrow(
      'exceed the 1 MiB total limit'
    )
    expect(openFile).toHaveBeenCalledTimes(4)
  })

  it('returns no documents when the native picker is cancelled', async () => {
    const { handlers } = createHarness()
    const { event } = createEvent({ id: 42 })

    await expect(handlers.get(IpcChannel.Attachments_PickCodeDocuments)?.(event)).resolves.toEqual(
      []
    )
  })

  it('reads through short filesystem reads before decoding a document', async () => {
    const { handlers, openFile, pickCodeDocuments, stat } = createHarness()
    const { event } = createEvent({ id: 42 })
    const source = new TextEncoder().encode('export {}')
    const fileHandle = {
      close: vi.fn().mockResolvedValue(undefined),
      read: vi.fn(async (buffer: Uint8Array, offset: number, length: number, position: number) => {
        const chunk = source.subarray(position, position + Math.min(2, length))
        buffer.set(chunk, offset)
        return { bytesRead: chunk.byteLength }
      })
    }
    pickCodeDocuments.mockResolvedValue({ canceled: false, filePaths: ['/tmp/short.ts'] })
    stat.mockResolvedValue({ size: source.byteLength })
    openFile.mockResolvedValue(fileHandle)

    await expect(handlers.get(IpcChannel.Attachments_PickCodeDocuments)?.(event)).resolves.toEqual([
      { type: 'document', name: 'short.ts', text: 'export {}' }
    ])
  })

  it('asks the user to shorten an overlong document name', async () => {
    const { handlers, openFile, pickCodeDocuments, stat } = createHarness()
    const { event } = createEvent({ id: 42 })
    const name = `${'a'.repeat(198)}.ts`
    pickCodeDocuments.mockResolvedValue({ canceled: false, filePaths: [`/tmp/${name}`] })

    await expect(handlers.get(IpcChannel.Attachments_PickCodeDocuments)?.(event)).rejects.toThrow(
      'Shorten or rename'
    )
    expect(stat).not.toHaveBeenCalled()
    expect(openFile).not.toHaveBeenCalled()
  })
})

describe('registerIpc chat handlers', () => {
  it('returns capabilities only to a trusted renderer', async () => {
    const { turnExecutor, handlers, mainWindow } = createHarness()
    const capabilities: ModelReasoningCapabilities = {
      selectableEfforts: ['medium', 'high'],
      defaultEffort: 'medium'
    }
    turnExecutor.getModelCapabilities.mockResolvedValue(capabilities)
    const trusted = createEvent({ id: 42 })
    const untrusted = createEvent({ id: 43, trusted: false })
    mainWindow.isTrustedRendererUrl.mockReturnValueOnce(true).mockReturnValueOnce(false)

    await expect(handlers.get(IpcChannel.Chat_GetCapabilities)?.(trusted.event)).resolves.toEqual(
      capabilities
    )
    expect(turnExecutor.getModelCapabilities).toHaveBeenCalledOnce()
    expect(() => handlers.get(IpcChannel.Chat_GetCapabilities)?.(untrusted.event)).toThrow()
  })

  it('starts a trusted turn under its sender ID and sends events only to that sender', () => {
    const { turnExecutor, handlers } = createHarness()
    const { event, sender } = createEvent({ id: 42 })
    const request = {
      sessionId: 'session-1',
      requestId: 'request-1',
      userMessage: { role: 'user', parts: [{ type: 'text', text: 'Hello' }] }
    }
    let emit: ((event: TurnStreamEvent) => void) | undefined
    let emitTitleUpdated: ((update: { sessionId: string; title: string }) => void) | undefined
    turnExecutor.startTurn.mockImplementation((_input, sink, titleSink) => {
      emit = sink
      emitTitleUpdated = titleSink
    })

    handlers.get(IpcChannel.Chat_StartTurn)?.(event, request)
    emit?.({ type: 'finish', requestId: 'request-1' })
    emitTitleUpdated?.({ sessionId: 'session-1', title: 'Greet the user' })

    expect(turnExecutor.startTurn).toHaveBeenCalledWith(
      { ownerId: '42', request },
      expect.any(Function),
      expect.any(Function)
    )
    expect(sender.send).toHaveBeenCalledWith(IpcChannel.Chat_TurnEvent, {
      type: 'finish',
      requestId: 'request-1'
    })
    expect(sender.send).toHaveBeenCalledWith(IpcChannel.Sessions_TitleUpdated, {
      sessionId: 'session-1',
      title: 'Greet the user'
    })
  })

  it('rejects a trusted turn request without a user message', () => {
    const { turnExecutor, handlers } = createHarness()
    const { event } = createEvent({ id: 42 })

    expect(() =>
      handlers.get(IpcChannel.Chat_StartTurn)?.(event, {
        sessionId: 'session-1',
        requestId: 'request-1',
        userMessage: { role: 'assistant', parts: [{ type: 'text', text: 'Not a prompt' }] }
      })
    ).toThrow('Invalid turn request')
    expect(turnExecutor.startTurn).not.toHaveBeenCalled()
  })

  it('rejects the legacy conversation ID field in a turn request', () => {
    const { turnExecutor, handlers } = createHarness()
    const { event } = createEvent({ id: 42 })

    expect(() =>
      handlers.get(IpcChannel.Chat_StartTurn)?.(event, {
        conversationId: 'conversation-1',
        requestId: 'request-1',
        userMessage: { role: 'user', parts: [{ type: 'text', text: 'Hello' }] }
      })
    ).toThrow('Invalid turn request')
    expect(turnExecutor.startTurn).not.toHaveBeenCalled()
  })

  it('aborts a validated turn under the invoking sender ID', () => {
    const { turnExecutor, handlers } = createHarness()
    const { event } = createEvent({ id: 42 })

    handlers.get(IpcChannel.Chat_AbortTurn)?.(event, 'request-1')

    expect(turnExecutor.abortTurn).toHaveBeenCalledWith({
      ownerId: '42',
      requestId: 'request-1'
    })
  })

  it.each([undefined, '', { requestId: 'request-1' }])(
    'rejects an invalid turn abort request',
    (input) => {
      const { turnExecutor, handlers } = createHarness()
      const { event } = createEvent({ id: 42 })

      expect(() => handlers.get(IpcChannel.Chat_AbortTurn)?.(event, input)).toThrow(
        'Invalid turn request'
      )
      expect(turnExecutor.abortTurn).not.toHaveBeenCalled()
    }
  )

  it.each([
    { isMainFrame: false, trusted: true },
    { isMainFrame: true, trusted: false }
  ])('rejects untrusted senders before starting a turn', ({ isMainFrame, trusted }) => {
    const { turnExecutor, handlers, mainWindow } = createHarness()
    mainWindow.isTrustedRendererUrl.mockReturnValue(trusted)
    const { event } = createEvent({ id: 42, isMainFrame, trusted })

    expect(() =>
      handlers.get(IpcChannel.Chat_StartTurn)?.(event, {
        sessionId: 'session-1',
        requestId: 'request-1',
        userMessage: { role: 'user', parts: [{ type: 'text', text: 'Hello' }] }
      })
    ).toThrow()
    expect(turnExecutor.startTurn).not.toHaveBeenCalled()
  })

  it('aborts all runs only when the invoking sender is destroyed', () => {
    const { turnExecutor, handlers } = createHarness()
    const first = createEvent({ id: 42 })
    const second = createEvent({ id: 43 })

    handlers.get(IpcChannel.Chat_StartTurn)?.(first.event, {
      sessionId: 'session-1',
      requestId: 'request-1',
      userMessage: { role: 'user', parts: [{ type: 'text', text: 'Hello' }] }
    })
    handlers.get(IpcChannel.Chat_StartTurn)?.(second.event, {
      sessionId: 'session-1',
      requestId: 'request-1',
      userMessage: { role: 'user', parts: [{ type: 'text', text: 'Hello' }] }
    })
    first.destroyedListeners.forEach((listener) => listener())

    expect(turnExecutor.abortAllTurns).toHaveBeenCalledWith('42')
    expect(turnExecutor.abortAllTurns).not.toHaveBeenCalledWith('43')
  })

  it('stops the owner run instead of sending to a disposed renderer frame', () => {
    const { turnExecutor, handlers } = createHarness()
    const { event, sender } = createEvent({ id: 42, frameDestroyed: true })
    let emit: ((event: TurnStreamEvent) => void) | undefined
    turnExecutor.startTurn.mockImplementation((_input, sink) => {
      emit = sink
    })

    handlers.get(IpcChannel.Chat_StartTurn)?.(event, {
      sessionId: 'session-1',
      requestId: 'request-1',
      userMessage: { role: 'user', parts: [{ type: 'text', text: 'Hello' }] }
    })
    emit?.({ type: 'finish', requestId: 'request-1' })

    expect(sender.send).not.toHaveBeenCalled()
    expect(turnExecutor.abortAllTurns).toHaveBeenCalledWith('42')
  })
})

describe('registerIpc session profile handlers', () => {
  it('delegates validated session model and thinking updates', () => {
    const { turnExecutor, handlers } = createHarness()
    const { event } = createEvent({ id: 42 })

    handlers.get(IpcChannel.Sessions_SetModelEntry)?.(event, {
      sessionId: 'session-1',
      modelEntryId: 'ollama:qwen3'
    })
    handlers.get(IpcChannel.Sessions_SetThinkingEffort)?.(event, {
      sessionId: 'session-1',
      thinkingEffort: 'high'
    })

    expect(turnExecutor.updateSessionModelEntry).toHaveBeenCalledWith('session-1', 'ollama:qwen3')
    expect(turnExecutor.updateSessionThinkingEffort).toHaveBeenCalledWith('session-1', 'high')
  })

  it.each([
    [IpcChannel.Sessions_SetModelEntry, { sessionId: 'session-1', modelEntryId: '' }],
    [IpcChannel.Sessions_SetThinkingEffort, { sessionId: '', thinkingEffort: 'high' }],
    [IpcChannel.Sessions_SetThinkingEffort, { sessionId: 'session-1', thinkingEffort: 'invalid' }]
  ])('rejects an invalid session profile update', (channel, input) => {
    const { turnExecutor, handlers } = createHarness()
    const { event } = createEvent({ id: 42 })

    expect(() => handlers.get(channel)?.(event, input)).toThrow()
    expect(turnExecutor.updateSessionModelEntry).not.toHaveBeenCalled()
    expect(turnExecutor.updateSessionThinkingEffort).not.toHaveBeenCalled()
  })
})

describe('registerIpc session handlers', () => {
  it('captures the selected project root when creating a session', () => {
    const { handlers, session, workspace } = createHarness()
    const { event } = createEvent({ id: 42 })
    workspace.getActiveProjectContext.mockReturnValue({
      kind: 'project',
      projectId: 'project-1',
      rootPath: '/projects/one'
    })

    handlers.get(IpcChannel.Sessions_Create)?.(event, {
      title: 'Project chat',
      projectId: 'project-1'
    })

    expect(session.createSession).toHaveBeenCalledWith({
      title: 'Project chat',
      defaultProfile: null,
      projectId: 'project-1',
      cwd: '/projects/one'
    })
  })
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
      defaultProfile: null,
      projectId: 'default',
      cwd: '/workspaces/default'
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

describe('registerIpc workspace handlers', () => {
  it('opens only the active workspace directory for a trusted renderer', async () => {
    const { handlers, openPath, workspace } = createHarness()
    const { event } = createEvent({ id: 42 })
    workspace.getActiveProjectContext.mockReturnValue({
      kind: 'project',
      projectId: 'project-1',
      rootPath: '/projects/one'
    })

    await expect(
      handlers.get(IpcChannel.Workspaces_Reveal)?.(event, 'project-1')
    ).resolves.toBeUndefined()

    expect(workspace.getActiveProjectContext).toHaveBeenCalledWith('project-1')
    expect(openPath).toHaveBeenCalledWith('/projects/one')
  })

  it('lists projects for a trusted renderer', () => {
    const { handlers, workspace } = createHarness()
    const { event } = createEvent({ id: 42 })
    const project = { id: 'project-1', name: 'One', rootPath: '/projects/one', isDefault: false }
    workspace.listProjects.mockReturnValue([project])

    expect(handlers.get(IpcChannel.Workspaces_List)?.(event)).toEqual([project])
  })

  it('sets a validated project as the default for a trusted renderer', async () => {
    const { handlers, workspace } = createHarness()
    const { event } = createEvent({ id: 42 })
    const project = { id: 'project-1', name: 'One', rootPath: '/projects/one', isDefault: false }
    workspace.setDefaultProject.mockResolvedValue({ ...project, isDefault: true })

    await expect(
      handlers.get(IpcChannel.Workspaces_SetDefault)?.(event, 'project-1')
    ).resolves.toEqual({ ...project, isDefault: true })
  })

  it('renames a validated project for a trusted renderer', async () => {
    const { handlers, workspace } = createHarness()
    const { event } = createEvent({ id: 42 })
    const project = { id: 'project-1', name: 'One', rootPath: '/projects/one', isDefault: false }
    workspace.renameProject.mockResolvedValue(project)

    await expect(
      handlers.get(IpcChannel.Workspaces_Rename)?.(event, {
        projectId: 'project-1',
        name: 'Renamed'
      })
    ).resolves.toEqual(project)
  })

  it('rejects an invalid project ID before archiving for a trusted renderer', () => {
    const { handlers } = createHarness()
    const { event } = createEvent({ id: 42 })

    expect(() => handlers.get(IpcChannel.Workspaces_Archive)?.(event, '')).toThrow(
      'Invalid workspace project ID'
    )
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
