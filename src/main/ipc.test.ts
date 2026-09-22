import { describe, expect, it, vi } from 'vitest'

import { IpcChannel } from '@shared/IpcChannel'
import type { ModelReasoningCapabilities } from '@shared/data/schemas/chat'
import type { TurnStreamEvent } from '@shared/ipc/schemas/chat'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { ReadOptions } from 'node:fs'
import type { TurnExecutor } from './ai/chat/turn-executor'
import type { ProviderService } from './ai/providers/provider-service'
import type { SessionRuntimeService } from './ai/sessions/session-runtime-service'
import type { WorkspaceService } from './ai/workspaces/workspace-service'
import { registerIpc } from './ipc'
import type { MainWindowService } from './services/main-window-service'
import type { PreferenceService } from './services/preference-service'

type Handler = Parameters<IpcMain['handle']>[1]
// SAFETY: structural subset of the fs FileHandle that the IPC attachment handlers consume;
// the offset union mirrors both fs read overloads so the double stays assignable to the real handle.
type IpcFileHandle = {
  close: () => Promise<void>
  read: (
    buffer: Uint8Array,
    offset?: number | ReadOptions | null,
    length?: number,
    position?: number
  ) => Promise<{ bytesRead: number; buffer: Uint8Array }>
}

function createFileHandle(bytes: Uint8Array, maxChunkSize = bytes.byteLength) {
  return {
    close: vi.fn<IpcFileHandle['close']>().mockResolvedValue(undefined),
    read: vi.fn<IpcFileHandle['read']>(async (buffer, offset, length, position) => {
      const from = position ?? 0
      const chunk = bytes.subarray(from, from + Math.min(length ?? bytes.byteLength, maxChunkSize))
      buffer.set(chunk, Number(offset ?? 0))
      return { buffer, bytesRead: chunk.byteLength }
    })
  }
}

function createHarness() {
  const handlers = new Map<string, Handler>()
  // SAFETY: structural subset of BrowserWindow with only the state accessors
  // the window-control handlers call directly; the full window is never used.
  const window = Object.assign(Object.create(null) as BrowserWindow, {
    close: vi.fn<BrowserWindow['close']>(),
    isFocused: vi.fn<BrowserWindow['isFocused']>(() => true),
    isFullScreen: vi.fn<BrowserWindow['isFullScreen']>(() => false),
    isMaximized: vi.fn<BrowserWindow['isMaximized']>(() => false),
    maximize: vi.fn<BrowserWindow['maximize']>(),
    minimize: vi.fn<BrowserWindow['minimize']>(),
    setFullScreen: vi.fn<BrowserWindow['setFullScreen']>(),
    unmaximize: vi.fn<BrowserWindow['unmaximize']>()
  })
  const turnExecutor = {
    abortTurn: vi.fn<TurnExecutor['abortTurn']>(),
    abortAllTurns: vi.fn<TurnExecutor['abortAllTurns']>(),
    getModelCapabilities: vi.fn<TurnExecutor['getModelCapabilities']>(),
    startTurn: vi.fn<TurnExecutor['startTurn']>(),
    updateSessionModelEntry: vi.fn<TurnExecutor['updateSessionModelEntry']>(),
    updateSessionThinkingEffort: vi.fn<TurnExecutor['updateSessionThinkingEffort']>()
  }
  const mainWindow = {
    isTrustedRendererUrl: vi.fn<MainWindowService['isTrustedRendererUrl']>(() => true)
  }
  const preference = {
    getAppearancePreference: vi.fn<PreferenceService['getAppearancePreference']>(),
    getResolvedAppearance: vi.fn<PreferenceService['getResolvedAppearance']>(),
    getThemeState: vi.fn<PreferenceService['getThemeState']>(),
    setAppearancePreference: vi.fn<PreferenceService['setAppearancePreference']>(),
    setThemePreferences: vi.fn<PreferenceService['setThemePreferences']>()
  }
  const provider = {
    addModel: vi.fn<ProviderService['addModel']>(),
    addCustomProvider: vi.fn<ProviderService['addCustomProvider']>(),
    updateCustomProvider: vi.fn<ProviderService['updateCustomProvider']>(),
    discoverModels: vi.fn<ProviderService['discoverModels']>(),
    getLibrary: vi.fn<ProviderService['getLibrary']>(),
    importModel: vi.fn<ProviderService['importModel']>(),
    setModelEnabled: vi.fn<ProviderService['setModelEnabled']>(),
    syncModels: vi.fn<ProviderService['syncModels']>(),
    removeCustomProvider: vi.fn<ProviderService['removeCustomProvider']>(),
    removeModel: vi.fn<ProviderService['removeModel']>(),
    saveConfiguration: vi.fn<ProviderService['saveConfiguration']>(),
    saveLibrary: vi.fn<ProviderService['saveLibrary']>(),
    selectModel: vi.fn<ProviderService['selectModel']>(),
    selectProvider: vi.fn<ProviderService['selectProvider']>(),
    testModel: vi.fn<ProviderService['testModel']>()
  }
  const session = {
    createSession: vi.fn<SessionRuntimeService['createSession']>(),
    deleteSession: vi.fn<SessionRuntimeService['deleteSession']>(),
    listSessions: vi.fn<SessionRuntimeService['listSessions']>(),
    loadSession: vi.fn<SessionRuntimeService['loadSession']>(),
    renameSession: vi.fn<SessionRuntimeService['renameSession']>()
  }
  const workspace = {
    addProject: vi.fn<WorkspaceService['addProject']>(),
    archiveProject: vi.fn<WorkspaceService['archiveProject']>(),
    getActiveProjectContext: vi.fn<WorkspaceService['getActiveProjectContext']>(),
    getDefaultWorkspaceContext: vi.fn<WorkspaceService['getDefaultWorkspaceContext']>(() => ({
      kind: 'project' as const,
      projectId: 'default',
      rootPath: '/workspaces/default'
    })),
    getProjectContext: vi.fn<WorkspaceService['getProjectContext']>(),
    listProjects: vi.fn<WorkspaceService['listProjects']>(),
    renameProject: vi.fn<WorkspaceService['renameProject']>(),
    setDefaultProject: vi.fn<WorkspaceService['setDefaultProject']>()
  }
  const openPath = vi.fn<(fullPath: string) => Promise<string>>().mockResolvedValue('')
  const pickCodeDocuments =
    vi.fn<(window: BrowserWindow) => Promise<{ canceled: boolean; filePaths: string[] }>>()
  pickCodeDocuments.mockResolvedValue({ canceled: true, filePaths: [] })
  const openFile = vi.fn<(filePath: string) => Promise<IpcFileHandle>>()
  const stat = vi.fn<(filePath: string) => Promise<{ size: number }>>()

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
    workspace,
    event: createEvent({ id: 42 }).event
  }
}

async function createAttachmentHarness({
  filePaths = [],
  file,
  chunkSize,
  size
}: {
  filePaths?: string[]
  file?: Uint8Array
  chunkSize?: number
  size?: number
} = {}) {
  const harness = createHarness()
  harness.pickCodeDocuments.mockResolvedValue({ canceled: false, filePaths })
  if (size !== undefined) harness.stat.mockResolvedValue({ size })
  if (file) harness.openFile.mockResolvedValue(createFileHandle(file, chunkSize))
  return harness
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
  const senderFrame = { isDestroyed: vi.fn<() => boolean>(() => frameDestroyed) }
  const sender = {
    id,
    mainFrame: senderFrame,
    isDestroyed: vi.fn<() => boolean>(() => false),
    once: vi.fn<(event: string, listener: () => void) => void>((event, listener) => {
      if (event === 'destroyed') destroyedListeners.push(listener)
    }),
    send: vi.fn<(channel: string, ...args: unknown[]) => void>()
  }
  const invokingFrame = isMainFrame ? sender.mainFrame : {}

  // SAFETY: The handlers exercise only sender identity, sender frame identity, and fake event methods.
  const event = Object.assign(Object.create(null) as IpcMainInvokeEvent, {
    sender,
    senderFrame: invokingFrame
  })

  return { destroyedListeners, event, sender, trusted }
}

const startTurnRequest = {
  sessionId: 'session-1',
  requestId: 'request-1',
  userMessage: { role: 'user', parts: [{ type: 'text', text: 'Hello' }] }
}

describe('registerIpc window control handlers', () => {
  it('user gets the focus state when the renderer asks, then it reflects that window', () => {
    const { handlers, window, event } = createHarness()

    expect(handlers.get(IpcChannel.WindowControls_IsFocused)?.(event)).toBe(true)
    expect(window.isFocused).toHaveBeenCalled()
  })
})

describe('registerIpc attachment handlers', () => {
  it('user gets document text when picking files, then only name and content come back', async () => {
    const { handlers, openFile, event } = await createAttachmentHarness({
      filePaths: ['/tmp/a.ts'],
      size: 22,
      file: new TextEncoder().encode('export const value = 1')
    })

    await expect(handlers.get(IpcChannel.Attachments_PickCodeDocuments)?.(event)).resolves.toEqual([
      { type: 'document', name: 'a.ts', text: 'export const value = 1' }
    ])
    expect(openFile).toHaveBeenCalledWith('/tmp/a.ts')
  })

  it('user cannot attach an unsupported file type when picked, then no file is read', async () => {
    const { handlers, openFile, stat, event } = await createAttachmentHarness({
      filePaths: ['/tmp/archive.zip']
    })

    await expect(handlers.get(IpcChannel.Attachments_PickCodeDocuments)?.(event)).rejects.toThrow(
      'Only code and text documents can be attached.'
    )
    expect(stat).not.toHaveBeenCalled()
    expect(openFile).not.toHaveBeenCalled()
  })

  it('user learns a file is too large when it exceeds 256 KiB, then it is never read', async () => {
    const { handlers, openFile, event } = await createAttachmentHarness({
      filePaths: ['/tmp/large.ts'],
      size: 256 * 1024 + 1
    })

    await expect(handlers.get(IpcChannel.Attachments_PickCodeDocuments)?.(event)).rejects.toThrow(
      'larger than 256 KiB'
    )
    expect(openFile).not.toHaveBeenCalled()
  })

  it('user cannot attach binary data when a file is not UTF-8, then it is rejected', async () => {
    const { handlers, event } = await createAttachmentHarness({
      filePaths: ['/tmp/binary.ts'],
      size: 2,
      file: Uint8Array.from([0xc3, 0x28])
    })

    await expect(handlers.get(IpcChannel.Attachments_PickCodeDocuments)?.(event)).rejects.toThrow(
      'not valid UTF-8'
    )
  })

  it('user is stopped when the batch exceeds 1 MiB, then it is rejected', async () => {
    const { handlers, openFile, event } = await createAttachmentHarness({
      filePaths: Array.from({ length: 5 }, (_, index) => `/tmp/${index}.ts`),
      size: 256 * 1024,
      file: new Uint8Array(256 * 1024)
    })

    await expect(handlers.get(IpcChannel.Attachments_PickCodeDocuments)?.(event)).rejects.toThrow(
      'exceed the 1 MiB total limit'
    )
    expect(openFile).toHaveBeenCalledTimes(4)
  })

  it('user gets no documents when the picker is cancelled, then an empty list resolves', async () => {
    const { handlers, event } = createHarness()

    await expect(handlers.get(IpcChannel.Attachments_PickCodeDocuments)?.(event)).resolves.toEqual(
      []
    )
  })

  it('user still gets full text when the filesystem reads short, then it is complete', async () => {
    const source = new TextEncoder().encode('export {}')
    const { handlers, event } = await createAttachmentHarness({
      filePaths: ['/tmp/short.ts'],
      size: source.byteLength,
      file: source,
      chunkSize: 2
    })

    await expect(handlers.get(IpcChannel.Attachments_PickCodeDocuments)?.(event)).resolves.toEqual([
      { type: 'document', name: 'short.ts', text: 'export {}' }
    ])
  })

  it('user is asked to shorten the name when it is too long, then no file is read', async () => {
    const name = `${'a'.repeat(198)}.ts`
    const { handlers, openFile, stat, event } = await createAttachmentHarness({
      filePaths: [`/tmp/${name}`]
    })

    await expect(handlers.get(IpcChannel.Attachments_PickCodeDocuments)?.(event)).rejects.toThrow(
      'Shorten or rename'
    )
    expect(stat).not.toHaveBeenCalled()
    expect(openFile).not.toHaveBeenCalled()
  })
})

describe('registerIpc chat handlers', () => {
  it('user gets model capabilities when the renderer asks, then they are returned', async () => {
    const { turnExecutor, handlers, mainWindow, event } = createHarness()
    const capabilities: ModelReasoningCapabilities = {
      selectableEfforts: ['medium', 'high'],
      defaultEffort: 'medium'
    }
    turnExecutor.getModelCapabilities.mockResolvedValue(capabilities)
    mainWindow.isTrustedRendererUrl.mockReturnValue(true)

    await expect(handlers.get(IpcChannel.Chat_GetCapabilities)?.(event)).resolves.toEqual(
      capabilities
    )
    expect(turnExecutor.getModelCapabilities).toHaveBeenCalledOnce()
  })

  it('user cannot get model capabilities when the sender is untrusted, then nothing is delegated', () => {
    const { turnExecutor, handlers, mainWindow } = createHarness()
    mainWindow.isTrustedRendererUrl.mockReturnValue(false)
    const { event } = createEvent({ id: 43, trusted: false })

    expect(() => handlers.get(IpcChannel.Chat_GetCapabilities)?.(event)).toThrow(
      'Untrusted window control sender'
    )
    expect(turnExecutor.getModelCapabilities).not.toHaveBeenCalled()
  })

  it('user sees turn events when a turn runs, then they go only to the starting sender', () => {
    const { turnExecutor, handlers } = createHarness()
    const { event, sender } = createEvent({ id: 42 })
    let emit: ((event: TurnStreamEvent) => void) | undefined
    let emitTitleUpdated: ((update: { sessionId: string; title: string }) => void) | undefined
    turnExecutor.startTurn.mockImplementation((_input, sink, titleSink) => {
      emit = sink
      emitTitleUpdated = titleSink
    })

    handlers.get(IpcChannel.Chat_StartTurn)?.(event, startTurnRequest)
    emit?.({ type: 'finish', requestId: 'request-1' })
    emitTitleUpdated?.({ sessionId: 'session-1', title: 'Greet the user' })

    expect(turnExecutor.startTurn).toHaveBeenCalledWith(
      { ownerId: '42', request: startTurnRequest },
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

  it('user cannot start a turn when the user message is missing, then it is rejected', () => {
    const { turnExecutor, handlers, event } = createHarness()

    expect(() =>
      handlers.get(IpcChannel.Chat_StartTurn)?.(event, {
        sessionId: 'session-1',
        requestId: 'request-1',
        userMessage: { role: 'assistant', parts: [{ type: 'text', text: 'Not a prompt' }] }
      })
    ).toThrow('Invalid turn request')
    expect(turnExecutor.startTurn).not.toHaveBeenCalled()
  })

  it('user cannot start a turn when the conversation ID is legacy, then it is rejected', () => {
    const { turnExecutor, handlers, event } = createHarness()

    expect(() =>
      handlers.get(IpcChannel.Chat_StartTurn)?.(event, {
        conversationId: 'conversation-1',
        requestId: 'request-1',
        userMessage: { role: 'user', parts: [{ type: 'text', text: 'Hello' }] }
      })
    ).toThrow('Invalid turn request')
    expect(turnExecutor.startTurn).not.toHaveBeenCalled()
  })

  it('user aborts a turn when requested, then the abort is scoped to that sender', () => {
    const { turnExecutor, handlers, event } = createHarness()

    handlers.get(IpcChannel.Chat_AbortTurn)?.(event, 'request-1')

    expect(turnExecutor.abortTurn).toHaveBeenCalledWith({
      ownerId: '42',
      requestId: 'request-1'
    })
  })

  it.each([undefined, '', { requestId: 'request-1' }])(
    'user cannot abort a turn when the request is invalid, then nothing is delegated',
    (input) => {
      const { turnExecutor, handlers, event } = createHarness()

      expect(() => handlers.get(IpcChannel.Chat_AbortTurn)?.(event, input)).toThrow(
        'Invalid turn request'
      )
      expect(turnExecutor.abortTurn).not.toHaveBeenCalled()
    }
  )

  it.each([
    { isMainFrame: false, trusted: true },
    { isMainFrame: true, trusted: false }
  ])(
    'user cannot start a turn when the sender is untrusted, then it is rejected',
    ({ isMainFrame, trusted }) => {
      const { turnExecutor, handlers, mainWindow } = createHarness()
      mainWindow.isTrustedRendererUrl.mockReturnValue(trusted)
      const { event } = createEvent({ id: 42, isMainFrame, trusted })

      expect(() => handlers.get(IpcChannel.Chat_StartTurn)?.(event, startTurnRequest)).toThrow(
        'Untrusted window control sender'
      )
      expect(turnExecutor.startTurn).not.toHaveBeenCalled()
    }
  )

  it('user has runs aborted when their window is destroyed, then others are unaffected', () => {
    const { turnExecutor, handlers } = createHarness()
    const first = createEvent({ id: 42 })
    const second = createEvent({ id: 43 })

    handlers.get(IpcChannel.Chat_StartTurn)?.(first.event, startTurnRequest)
    handlers.get(IpcChannel.Chat_StartTurn)?.(second.event, startTurnRequest)
    first.destroyedListeners.forEach((listener) => listener())

    expect(turnExecutor.abortAllTurns).toHaveBeenCalledWith('42')
    expect(turnExecutor.abortAllTurns).not.toHaveBeenCalledWith('43')
  })

  it('user has the run aborted when the frame is destroyed, then no events reach it', () => {
    const { turnExecutor, handlers } = createHarness()
    const { event, sender } = createEvent({ id: 42, frameDestroyed: true })
    let emit: ((event: TurnStreamEvent) => void) | undefined
    turnExecutor.startTurn.mockImplementation((_input, sink) => {
      emit = sink
    })

    handlers.get(IpcChannel.Chat_StartTurn)?.(event, startTurnRequest)
    emit?.({ type: 'finish', requestId: 'request-1' })

    expect(sender.send).not.toHaveBeenCalled()
    expect(turnExecutor.abortAllTurns).toHaveBeenCalledWith('42')
  })
})

describe('registerIpc session profile handlers', () => {
  it('user sets model and thinking effort when the input is valid, then both apply', () => {
    const { turnExecutor, handlers, event } = createHarness()

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
  ])(
    'user cannot update the profile when the input is invalid, then nothing applies',
    (channel, input) => {
      const { turnExecutor, handlers, event } = createHarness()

      expect(() => handlers.get(channel)?.(event, input)).toThrow(
        /Invalid session (model|thinking effort)/
      )
      expect(turnExecutor.updateSessionModelEntry).not.toHaveBeenCalled()
      expect(turnExecutor.updateSessionThinkingEffort).not.toHaveBeenCalled()
    }
  )
})

describe('registerIpc session handlers', () => {
  it('user starts in the chosen project when creating a session, then it seeds the cwd', () => {
    const { handlers, session, workspace, event } = createHarness()
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
  it('user sees the saved sessions when listing them, then each summary returns', () => {
    const { handlers, session, event } = createHarness()
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

    expect(handlers.get(IpcChannel.Sessions_List)?.(event)).toEqual(summaries)
    expect(session.listSessions).toHaveBeenCalledOnce()
  })

  it('user cannot list sessions when the sender is untrusted, then nothing is delegated', () => {
    const { handlers, mainWindow, session } = createHarness()
    mainWindow.isTrustedRendererUrl.mockReturnValue(false)
    const { event } = createEvent({ id: 43, trusted: false })

    expect(() => handlers.get(IpcChannel.Sessions_List)?.(event)).toThrow(
      'Untrusted window control sender'
    )
    expect(session.listSessions).not.toHaveBeenCalled()
  })

  it('user creates a session when providing a title, then it is created in the default workspace', () => {
    const { handlers, session, event } = createHarness()
    const summary = {
      id: 'session-1',
      title: 'Saved chat',
      defaultProfile: null,
      createdAt: 1,
      updatedAt: 2,
      lastActivityAt: 2
    }
    session.createSession.mockReturnValue(summary)

    expect(handlers.get(IpcChannel.Sessions_Create)?.(event, { title: 'Saved chat' })).toEqual(
      summary
    )
    expect(session.createSession).toHaveBeenCalledWith({
      title: 'Saved chat',
      defaultProfile: null,
      projectId: 'default',
      cwd: '/workspaces/default'
    })
  })

  it('user gets the persisted transcript when loading a session, then it is returned by ID', () => {
    const { handlers, session, event } = createHarness()
    const persisted = {
      id: 'session-1',
      title: 'Saved chat',
      defaultProfile: null,
      createdAt: 1,
      updatedAt: 2,
      lastActivityAt: 2,
      messages: []
    }
    session.loadSession.mockReturnValue(persisted)

    expect(handlers.get(IpcChannel.Sessions_Load)?.(event, 'session-1')).toEqual(persisted)
    expect(session.loadSession).toHaveBeenCalledWith('session-1')
  })

  it('user deletes a session when requesting its removal, then the deletion is delegated by ID', () => {
    const { handlers, session, event } = createHarness()

    expect(handlers.get(IpcChannel.Sessions_Delete)?.(event, 'session-1')).toBeUndefined()
    expect(session.deleteSession).toHaveBeenCalledWith('session-1')
  })

  it('user renames a session when providing a new title, then the updated summary returns', () => {
    const { handlers, session, event } = createHarness()
    const summary = {
      id: 'session-1',
      title: 'Renamed chat',
      defaultProfile: null,
      createdAt: 1,
      updatedAt: 2,
      lastActivityAt: 2
    }
    session.renameSession.mockReturnValue(summary)

    expect(
      handlers.get(IpcChannel.Sessions_Rename)?.(event, {
        sessionId: 'session-1',
        title: 'Renamed chat'
      })
    ).toEqual(summary)
    expect(session.renameSession).toHaveBeenCalledWith('session-1', 'Renamed chat')
  })

  it('user gets an error when session input is invalid, then no mutation is delegated', () => {
    const { handlers, session, event } = createHarness()

    expect(() => handlers.get(IpcChannel.Sessions_Create)?.(event, { title: '' })).toThrow(
      'Invalid session request'
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
  const project = { id: 'project-1', name: 'One', rootPath: '/projects/one', isDefault: false }

  it('user sees the project folder open when revealing it, then only its root opens', async () => {
    const { handlers, openPath, workspace, event } = createHarness()
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

  it('user sees registered projects when listing workspaces, then the list is returned', () => {
    const { handlers, workspace, event } = createHarness()
    workspace.listProjects.mockReturnValue([project])

    expect(handlers.get(IpcChannel.Workspaces_List)?.(event)).toEqual([project])
  })

  it('user sets a default project when the ID is valid, then the updated one returns', async () => {
    const { handlers, workspace, event } = createHarness()
    workspace.setDefaultProject.mockResolvedValue({ ...project, isDefault: true })

    await expect(
      handlers.get(IpcChannel.Workspaces_SetDefault)?.(event, 'project-1')
    ).resolves.toEqual({ ...project, isDefault: true })
  })

  it('user renames a project when the name is valid, then the renamed one is returned', async () => {
    const { handlers, workspace, event } = createHarness()
    workspace.renameProject.mockResolvedValue(project)

    await expect(
      handlers.get(IpcChannel.Workspaces_Rename)?.(event, {
        projectId: 'project-1',
        name: 'Renamed'
      })
    ).resolves.toEqual(project)
  })

  it('user cannot archive a project when the ID is invalid, then it is rejected', () => {
    const { handlers, event } = createHarness()

    expect(() => handlers.get(IpcChannel.Workspaces_Archive)?.(event, '')).toThrow(
      'Invalid workspace project ID'
    )
  })
})

describe('registerIpc provider handlers', () => {
  it('user cannot discover models when the sender is untrusted, then nothing runs', async () => {
    const { handlers, mainWindow, provider, event } = createHarness()
    mainWindow.isTrustedRendererUrl.mockReturnValue(false)

    expect(() =>
      handlers.get(IpcChannel.Providers_DiscoverModels)?.(event, {
        provider: 'ollama',
        baseUrl: 'http://localhost:11434'
      })
    ).toThrow('Untrusted')
    expect(provider.discoverModels).not.toHaveBeenCalled()
  })

  it('user saves a provider configuration when valid, then it is passed through', async () => {
    const { handlers, provider, event } = createHarness()
    const configuration = { provider: 'ollama' as const, baseUrl: 'http://localhost:11434' }
    provider.saveConfiguration.mockResolvedValue(configuration)

    await expect(
      handlers.get(IpcChannel.Providers_SaveConfiguration)?.(event, configuration)
    ).resolves.toEqual(configuration)
    expect(provider.saveConfiguration).toHaveBeenCalledWith(configuration)
  })

  it('user saves the provider library when valid, then it is passed through', async () => {
    const { handlers, provider, event } = createHarness()
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
    expect(provider.saveLibrary).toHaveBeenCalledWith(library)
  })

  it('user selects a provider when the ID is valid, then the selection is delegated', async () => {
    const { handlers, provider, event } = createHarness()
    provider.selectProvider.mockResolvedValue('ollama')

    await expect(
      handlers.get(IpcChannel.Providers_SelectProvider)?.(event, 'ollama')
    ).resolves.toEqual('ollama')
    expect(provider.selectProvider).toHaveBeenCalledWith('ollama')
  })

  it('user cannot select a provider when the ID is empty, then nothing is delegated', () => {
    const { handlers, provider, event } = createHarness()

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

  it('user gets the full theme state when requesting it, then the resolved state returns', () => {
    const { handlers, preference, event } = createHarness()
    preference.getThemeState.mockReturnValue(themeState)

    expect(handlers.get(IpcChannel.Appearance_GetThemeState)?.(event)).toEqual(themeState)
  })

  it('user cannot get the theme state when the sender is untrusted, then it is rejected', () => {
    const { handlers, mainWindow, preference } = createHarness()
    mainWindow.isTrustedRendererUrl.mockReturnValue(false)
    const { event } = createEvent({ id: 43, trusted: false })

    expect(() => handlers.get(IpcChannel.Appearance_GetThemeState)?.(event)).toThrow(
      'Untrusted window control sender'
    )
    expect(preference.getThemeState).not.toHaveBeenCalled()
  })

  it('user saves theme preferences when submitting them, then the saved state returns', async () => {
    const { handlers, preference, event } = createHarness()
    preference.setThemePreferences.mockResolvedValue(themeState)

    await expect(
      handlers.get(IpcChannel.Appearance_SetThemePreferences)?.(event, themePreferences)
    ).resolves.toEqual(themeState)
    expect(preference.setThemePreferences).toHaveBeenCalledWith(themePreferences)
  })

  it('user cannot save theme preferences when a code theme is unsupported, then nothing is persisted', () => {
    const { handlers, preference, event } = createHarness()

    // The invoke wrapper validates before delegating; in the running app the
    // validation error reaches the renderer as a rejected invoke either way.
    expect(() =>
      handlers.get(IpcChannel.Appearance_SetThemePreferences)?.(event, {
        ...themePreferences,
        codeThemeLight: 'unsupported'
      })
    ).toThrow('Invalid theme preferences')
    expect(preference.setThemePreferences).not.toHaveBeenCalled()
  })
})
