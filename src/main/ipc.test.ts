import { describe, expect, it, vi } from 'vitest'

import { IpcChannel } from '@shared/IpcChannel'
import type { ChatStreamEvent } from '@shared/data/schemas/chat'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { registerIpc } from './ipc'

type Handler = Parameters<IpcMain['handle']>[1]

function createHarness() {
  const handlers = new Map<string, Handler>()
  const chat = {
    abort: vi.fn(),
    abortAll: vi.fn(),
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

  registerIpc(
    { mainWindow, preference, chat },
    {
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      // SAFETY: The chat handlers only use this value to establish a trusted calling window.
      getWindow: () => Object.create(null) as BrowserWindow
    }
  )

  return { chat, handlers, mainWindow }
}

function createEvent({
  id,
  isMainFrame = true,
  trusted = true
}: {
  id: number
  isMainFrame?: boolean
  trusted?: boolean
}) {
  const destroyedListeners: Array<() => void> = []
  const sender = {
    id,
    mainFrame: {},
    once: vi.fn((event: string, listener: () => void) => {
      if (event === 'destroyed') destroyedListeners.push(listener)
    }),
    send: vi.fn()
  }
  const senderFrame = isMainFrame ? sender.mainFrame : {}

  // SAFETY: The handlers exercise only sender identity, sender frame identity, and fake event methods.
  const event = Object.assign(Object.create(null) as IpcMainInvokeEvent, { sender, senderFrame })

  return { destroyedListeners, event, sender, trusted }
}

describe('registerIpc chat handlers', () => {
  it('starts a trusted request under its sender ID and sends events only to that sender', () => {
    const { chat, handlers } = createHarness()
    const { event, sender } = createEvent({ id: 42 })
    const request = {
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
      handlers.get(IpcChannel.Chat_Start)?.(event, { requestId: 'request-1', messages: [] })
    ).toThrow()
    expect(chat.start).not.toHaveBeenCalled()
  })

  it('aborts all runs only when the invoking sender is destroyed', () => {
    const { chat, handlers } = createHarness()
    const first = createEvent({ id: 42 })
    const second = createEvent({ id: 43 })

    handlers.get(IpcChannel.Chat_Start)?.(first.event, { requestId: 'request-1', messages: [] })
    handlers.get(IpcChannel.Chat_Start)?.(second.event, { requestId: 'request-1', messages: [] })
    first.destroyedListeners.forEach((listener) => listener())

    expect(chat.abortAll).toHaveBeenCalledWith('42')
    expect(chat.abortAll).not.toHaveBeenCalledWith('43')
  })
})
