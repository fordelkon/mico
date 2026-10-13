import type { ReadOptions } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ModelReasoningCapabilities } from '@shared/data/schemas/chat'
import { IpcChannel } from '@shared/IpcChannel'
import type { TurnStreamEvent } from '@shared/ipc/schemas/chat'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { Conversations } from './ai/conversation'
import type { Models } from './ai/models'
import { Workspaces } from './ai/workspace'
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
    respondToPermission: vi.fn<Conversations['respondToPermission']>(),
    abortTurn: vi.fn<Conversations['abortTurn']>(),
    abortAllTurns: vi.fn<Conversations['abortAllTurns']>(),
    startTurn: vi.fn<Conversations['startTurn']>()
  }
  const modelProfile = {
    getCapabilities: vi.fn<Conversations['getCapabilities']>(),
    updateSessionModelEntry: vi.fn<Conversations['setSessionModelEntry']>(),
    updateSessionThinkingEffort: vi.fn<Conversations['setSessionThinkingEffort']>()
  }
  const mainWindow = {
    isTrustedRendererUrl: vi.fn<MainWindowService['isTrustedRendererUrl']>(() => true)
  }
  const preference = {
    getThemeState: vi.fn<PreferenceService['getThemeState']>(),
    setAppearancePreference: vi.fn<PreferenceService['setAppearancePreference']>(),
    setThemePreferences: vi.fn<PreferenceService['setThemePreferences']>()
  }
  const provider = {
    addModel: vi.fn<Models['addModel']>(),
    discoverModels: vi.fn<Models['discoverModels']>(),
    getLibrary: vi.fn<Models['getLibrary']>(),
    saveLibrary: vi.fn<Models['saveLibrary']>(),
    syncModels: vi.fn<Models['syncModels']>(),
    testModel: vi.fn<Models['testModel']>()
  }
  const session = {
    createSession: vi.fn<Conversations['createSession']>(),
    deleteSession: vi.fn<Conversations['deleteSession']>(),
    listSessions: vi.fn<Conversations['listSessions']>(),
    loadSession: vi.fn<Conversations['loadSession']>(),
    renameSession: vi.fn<Conversations['renameSession']>()
  }
  const sessionCompactor = {
    compact: vi.fn<Conversations['compact']>(),
    cancel: vi.fn<Conversations['cancelCompaction']>().mockResolvedValue(undefined)
  }
  const workspace = Object.assign(new Workspaces(), {
    addProject: vi.fn<Workspaces['addProject']>(),
    archiveProject: vi.fn<Workspaces['archiveProject']>(),
    getActiveProjectContext: vi.fn<Workspaces['getActiveProjectContext']>(),
    getDefaultWorkspaceContext: vi.fn<Workspaces['getDefaultWorkspaceContext']>(() => ({
      kind: 'project' as const,
      projectId: 'default',
      rootPath: '/workspaces/default'
    })),
    getProjectContext: vi.fn<Workspaces['getProjectContext']>(),
    listProjects: vi.fn<Workspaces['listProjects']>(),
    renameProject: vi.fn<Workspaces['renameProject']>(),
    setDefaultProject: vi.fn<Workspaces['setDefaultProject']>()
  })
  const openPath = vi.fn<(fullPath: string) => Promise<string>>().mockResolvedValue('')
  const pickCodeDocuments =
    vi.fn<(window: BrowserWindow) => Promise<{ canceled: boolean; filePaths: string[] }>>()
  pickCodeDocuments.mockResolvedValue({ canceled: true, filePaths: [] })
  const openFile = vi.fn<(filePath: string) => Promise<IpcFileHandle>>()
  const stat = vi.fn<(filePath: string) => Promise<{ size: number }>>()

  registerIpc(
    {
      mainWindow,
      preference,
      models: provider,
      conversations: {
        ...turnExecutor,
        ...session,
        getCapabilities: modelProfile.getCapabilities,
        setSessionModelEntry: modelProfile.updateSessionModelEntry,
        setSessionThinkingEffort: modelProfile.updateSessionThinkingEffort,
        compact: sessionCompactor.compact,
        cancelCompaction: sessionCompactor.cancel
      },
      workspace
    },
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
    modelProfile,
    handlers,
    mainWindow,
    preference,
    provider,
    session,
    sessionCompactor,
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
    on: vi.fn<
      (
        event: string,
        listener: (details: { isMainFrame: boolean; isSameDocument: boolean }) => void
      ) => void
    >(),
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

describe('registerIpc skill catalog', () => {
  it('user browses a model-only skill when opening settings, then its source document is readable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mico-settings-skill-'))
    try {
      const base = join(root, '.agents/skills/mico-settings-hidden')
      const content =
        '---\nname: mico-settings-hidden\ndescription: Model guidance\nuser-invocable: false\n---\n# Private guidance\nRead carefully.'
      await mkdir(base, { recursive: true })
      await writeFile(join(base, 'SKILL.md'), content)
      const { handlers, event, workspace } = createHarness()
      workspace.getProjectContext.mockReturnValue({
        kind: 'project',
        projectId: 'registered',
        rootPath: root
      })
      const catalog: unknown = await handlers.get('skills:list')?.(event, {
        projectId: 'registered'
      })
      expect(catalog).toMatchObject({
        skills: expect.arrayContaining([
          expect.objectContaining({
            id: 'project-agents:mico-settings-hidden',
            userInvocable: false
          })
        ])
      })
      const document: unknown = await handlers.get('skills:read-document')?.(event, {
        projectId: 'registered',
        skillId: 'project-agents:mico-settings-hidden'
      })
      expect(document).toEqual({ content, body: '# Private guidance\nRead carefully.' })
      await expect(
        handlers.get('skills:read-document')?.(event, {
          projectId: 'registered',
          skillId: 'mico-settings-hidden'
        })
      ).rejects.toThrow('Unknown skill')
      await expect(
        handlers.get('skills:read-document')?.(event, {
          projectId: 'registered',
          skillId: '../../private'
        })
      ).rejects.toThrow('Unknown skill')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each(['skills:list', 'skills:read-document'])(
    'user supplies a filesystem root when calling %s, then settings rejects it',
    (channel) => {
      const { handlers, event } = createHarness()
      expect(() =>
        handlers.get(channel)?.(event, {
          projectId: 'registered',
          skillId: 'project-agents:review',
          cwd: '/private'
        })
      ).toThrow('Invalid skill')
    }
  )

  it('user selects a project when requesting skills, then its registered directory supplies the catalog', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mico-ipc-skill-'))
    try {
      const base = join(root, '.agents/skills/mico-ipc-catalog')
      await mkdir(base, { recursive: true })
      await writeFile(
        join(base, 'SKILL.md'),
        '---\nname: mico-ipc-catalog\ndescription: Project catalog\ndisable-model-invocation: true\n---\nCatalog instructions'
      )
      const { handlers, event, workspace } = createHarness()
      workspace.getProjectContext.mockReturnValue({
        kind: 'project',
        projectId: 'registered',
        rootPath: root
      })
      const catalog: unknown = await handlers.get(IpcChannel.Chat_GetSkillCatalog)?.(event, {
        projectId: 'registered'
      })
      expect(catalog).toMatchObject({
        skills: expect.arrayContaining([
          {
            id: 'project-agents:mico-ipc-catalog',
            name: 'mico-ipc-catalog',
            description: 'Project catalog',
            source: 'project-agents',
            userInvocable: true,
            disableModelInvocation: true
          }
        ])
      })
      expect(workspace.getProjectContext).toHaveBeenCalledWith('registered')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('user has no project when opening the catalog, then no filesystem skills are exposed', async () => {
    const { handlers, event, workspace } = createHarness()
    await expect(handlers.get(IpcChannel.Chat_GetSkillCatalog)?.(event, {})).resolves.toEqual({
      skills: [],
      diagnostics: []
    })
    expect(workspace.getProjectContext).not.toHaveBeenCalled()
  })

  it('user submits a path when requesting skills, then the catalog rejects it', () => {
    const { handlers, event, workspace } = createHarness()
    expect(() =>
      handlers.get(IpcChannel.Chat_GetSkillCatalog)?.(event, {
        projectId: 'project',
        cwd: '/private'
      })
    ).toThrow('Invalid skill catalog request')
    expect(workspace.getProjectContext).not.toHaveBeenCalled()
  })

  it('user selects an unknown project when requesting skills, then project ownership rejects it', async () => {
    const { handlers, event, workspace } = createHarness()
    workspace.getProjectContext.mockImplementation(() => {
      throw new Error('Project does not exist.')
    })
    await expect(
      handlers.get(IpcChannel.Chat_GetSkillCatalog)?.(event, { projectId: '/private' })
    ).rejects.toThrow('Project does not exist.')
    expect(workspace.getProjectContext).toHaveBeenCalledWith('/private')
  })
})

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
  it('user answers an approval when invoking IPC, then the trusted sender owns the decision', () => {
    const { turnExecutor, handlers, event } = createHarness()
    const response = { approvalId: '00000000-0000-4000-8000-000000000001', decision: 'allow' }
    handlers.get(IpcChannel.Chat_RespondToPermission)?.(event, response)
    expect(turnExecutor.respondToPermission).toHaveBeenCalledWith('42', response)
  })

  it('user sends arbitrary approval input when invoking IPC, then malformed decisions are rejected', () => {
    const { turnExecutor, handlers, event } = createHarness()
    expect(() =>
      handlers.get(IpcChannel.Chat_RespondToPermission)?.(event, {
        approvalId: 'invalid',
        decision: 'allow',
        input: { command: 'changed' }
      })
    ).toThrow('Invalid tool approval response')
    expect(turnExecutor.respondToPermission).not.toHaveBeenCalled()
  })
  it('user gets model capabilities when the renderer asks, then they are returned', async () => {
    const { modelProfile, handlers, mainWindow, event } = createHarness()
    const capabilities: ModelReasoningCapabilities = {
      selectableEfforts: ['medium', 'high'],
      defaultEffort: 'medium'
    }
    modelProfile.getCapabilities.mockResolvedValue(capabilities)
    mainWindow.isTrustedRendererUrl.mockReturnValue(true)

    await expect(handlers.get(IpcChannel.Chat_GetCapabilities)?.(event)).resolves.toEqual(
      capabilities
    )
    expect(modelProfile.getCapabilities).toHaveBeenCalledOnce()
  })

  it('user requests capabilities when a handler returns no result, then IPC rejects the response', async () => {
    const { handlers, event } = createHarness()
    await expect(async () =>
      handlers.get(IpcChannel.Chat_GetCapabilities)?.(event)
    ).rejects.toThrow(
      'Invalid response for chat:get-capabilities. Restart the application and try again.'
    )
  })

  it('user cannot get model capabilities when the sender is untrusted, then nothing is delegated', () => {
    const { modelProfile, handlers, mainWindow } = createHarness()
    mainWindow.isTrustedRendererUrl.mockReturnValue(false)
    const { event } = createEvent({ id: 43, trusted: false })

    expect(() => handlers.get(IpcChannel.Chat_GetCapabilities)?.(event)).toThrow(
      'Untrusted window control sender'
    )
    expect(modelProfile.getCapabilities).not.toHaveBeenCalled()
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
    const { modelProfile, handlers, event } = createHarness()

    handlers.get(IpcChannel.Sessions_SetModelEntry)?.(event, {
      sessionId: 'session-1',
      modelEntryId: 'ollama:qwen3'
    })
    handlers.get(IpcChannel.Sessions_SetThinkingEffort)?.(event, {
      sessionId: 'session-1',
      thinkingEffort: 'high'
    })

    expect(modelProfile.updateSessionModelEntry).toHaveBeenCalledWith('session-1', 'ollama:qwen3')
    expect(modelProfile.updateSessionThinkingEffort).toHaveBeenCalledWith('session-1', 'high')
  })

  it.each([
    [IpcChannel.Sessions_SetModelEntry, { sessionId: 'session-1', modelEntryId: '' }],
    [IpcChannel.Sessions_SetThinkingEffort, { sessionId: '', thinkingEffort: 'high' }],
    [IpcChannel.Sessions_SetThinkingEffort, { sessionId: 'session-1', thinkingEffort: 'invalid' }]
  ])(
    'user cannot update the profile when the input is invalid, then nothing applies',
    (channel, input) => {
      const { modelProfile, handlers, event } = createHarness()

      expect(() => handlers.get(channel)?.(event, input)).toThrow(
        /Invalid session (model|thinking effort)/
      )
      expect(modelProfile.updateSessionModelEntry).not.toHaveBeenCalled()
      expect(modelProfile.updateSessionThinkingEffort).not.toHaveBeenCalled()
    }
  )
})

describe('registerIpc session handlers', () => {
  it('user starts in the chosen project when creating a session, then it seeds the cwd', () => {
    const { handlers, session, workspace, event } = createHarness()
    session.createSession.mockReturnValue({
      id: 'session-1',
      title: 'Project chat',
      projectId: 'project-1',
      cwd: '/projects/one',
      defaultProfile: null,
      createdAt: 1,
      updatedAt: 1,
      lastActivityAt: 1
    })
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
  it('user cannot list sessions when the sender is untrusted, then nothing is delegated', () => {
    const { handlers, mainWindow, session } = createHarness()
    mainWindow.isTrustedRendererUrl.mockReturnValue(false)
    const { event } = createEvent({ id: 43, trusted: false })

    expect(() => handlers.get(IpcChannel.Sessions_List)?.(event)).toThrow(
      'Untrusted window control sender'
    )
    expect(session.listSessions).not.toHaveBeenCalled()
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

describe('registerIpc session compaction handlers', () => {
  const request = { sessionId: 'session-1', requestId: 'summary-1' }

  it('user starts a summary when trusted, then receives its durable outcome', async () => {
    const { handlers, sessionCompactor, event } = createHarness()
    const outcome = { status: 'accepted', checkpointEventId: 'checkpoint-1' } as const
    sessionCompactor.compact.mockResolvedValue(outcome)
    await expect(handlers.get(IpcChannel.Sessions_Compact)?.(event, request)).resolves.toEqual(
      outcome
    )
    expect(sessionCompactor.compact).toHaveBeenCalledWith('session-1')
  })

  it('user sends an invalid summary task when invoking, then nothing starts', () => {
    const { handlers, sessionCompactor, event } = createHarness()
    expect(() =>
      handlers.get(IpcChannel.Sessions_Compact)?.(event, { sessionId: 'session-1' })
    ).toThrow('Invalid summary request')
    expect(sessionCompactor.compact).not.toHaveBeenCalled()
  })

  it('user cancels from another window when a summary runs, then cancellation is refused', async () => {
    const { handlers, sessionCompactor, event } = createHarness()
    const pending = Promise.withResolvers<Awaited<ReturnType<Conversations['compact']>>>()
    sessionCompactor.compact.mockReturnValue(pending.promise)
    const started = handlers.get(IpcChannel.Sessions_Compact)?.(event, request)
    const { event: other } = createEvent({ id: 43 })
    await expect(handlers.get(IpcChannel.Sessions_CancelCompact)?.(other, request)).rejects.toThrow(
      'another window'
    )
    expect(sessionCompactor.cancel).not.toHaveBeenCalled()
    pending.resolve({ status: 'cancelled' })
    await started
  })

  it('user repeats a request when a summary runs, then the original task keeps cancellation ownership', async () => {
    const { handlers, sessionCompactor, event } = createHarness()
    const pending = Promise.withResolvers<Awaited<ReturnType<Conversations['compact']>>>()
    sessionCompactor.compact.mockReturnValue(pending.promise)
    const started = handlers.get(IpcChannel.Sessions_Compact)?.(event, request)
    await expect(
      handlers.get(IpcChannel.Sessions_Compact)?.(event, { ...request, requestId: 'summary-2' })
    ).rejects.toThrow('already running')
    await handlers.get(IpcChannel.Sessions_CancelCompact)?.(event, {
      ...request,
      requestId: 'summary-2'
    })
    expect(sessionCompactor.cancel).not.toHaveBeenCalled()
    const acknowledgement = Promise.withResolvers<void>()
    sessionCompactor.cancel.mockReturnValue(acknowledgement.promise)
    const cancelled = handlers.get(IpcChannel.Sessions_CancelCompact)?.(event, request)
    expect(sessionCompactor.cancel).toHaveBeenCalledWith('session-1')
    acknowledgement.resolve()
    await cancelled
    pending.resolve({ status: 'cancelled' })
    await started
  })

  it.each(['render-process-gone', 'did-start-navigation'])(
    'user loses the renderer when %s occurs, then its running summary is cancelled',
    async (lifecycle) => {
      const { handlers, sessionCompactor } = createHarness()
      const { event, sender } = createEvent({ id: 101 })
      const pending = Promise.withResolvers<Awaited<ReturnType<Conversations['compact']>>>()
      sessionCompactor.compact.mockReturnValue(pending.promise)
      const started = handlers.get(IpcChannel.Sessions_Compact)?.(event, request)
      const listener = sender.on.mock.calls.find(([name]) => name === lifecycle)?.[1]
      if (!listener) throw new Error('Missing renderer lifecycle listener')
      // The Electron callback accepts external lifecycle details, supplied by this event seam.
      listener({ isMainFrame: true, isSameDocument: false })
      expect(sessionCompactor.cancel).toHaveBeenCalledWith('session-1')
      pending.resolve({ status: 'cancelled' })
      await started
    }
  )

  it('user closes the owning renderer when cancellation fails, then teardown observes the failure', async () => {
    const { handlers, sessionCompactor } = createHarness()
    const { event, destroyedListeners } = createEvent({ id: 99 })
    const pending = Promise.withResolvers<Awaited<ReturnType<Conversations['compact']>>>()
    const failed = Promise.withResolvers<void>()
    sessionCompactor.compact.mockReturnValue(pending.promise)
    sessionCompactor.cancel.mockReturnValue(failed.promise)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const started = handlers.get(IpcChannel.Sessions_Compact)?.(event, request)
      for (const listener of destroyedListeners) listener()
      expect(sessionCompactor.cancel).toHaveBeenCalledWith('session-1')
      failed.reject(new Error('storage closed'))
      await failed.promise.catch(() => {})
      expect(log).toHaveBeenCalled()
      pending.resolve({ status: 'cancelled' })
      await started
    } finally {
      log.mockRestore()
    }
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
    const renamed = { ...project, name: 'Renamed' }
    workspace.renameProject.mockResolvedValue(renamed)

    await expect(
      handlers.get(IpcChannel.Workspaces_Rename)?.(event, {
        projectId: 'project-1',
        name: 'Renamed'
      })
    ).resolves.toEqual(renamed)
    expect(workspace.renameProject).toHaveBeenCalledWith('project-1', 'Renamed')
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
})

describe('registerIpc theme handlers', () => {
  const themePreferences = {
    appearancePreference: 'system' as const,
    codeThemeDark: 'dracula' as const,
    codeThemeLight: 'github-light' as const,
    themePresetDark: 'tokyo-night' as const,
    themePresetLight: 'one-nord-light' as const
  }
  it('user cannot get the theme state when the sender is untrusted, then it is rejected', () => {
    const { handlers, mainWindow, preference } = createHarness()
    mainWindow.isTrustedRendererUrl.mockReturnValue(false)
    const { event } = createEvent({ id: 43, trusted: false })

    expect(() => handlers.get(IpcChannel.Appearance_GetThemeState)?.(event)).toThrow(
      'Untrusted window control sender'
    )
    expect(preference.getThemeState).not.toHaveBeenCalled()
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
