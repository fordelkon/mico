import { describe, expect, it, vi } from 'vitest'

import { registerWindowClosingHandlers } from './window-lifecycle'

type CloseEvent = { preventDefault: () => void }

class TestWindow {
  private closeListeners: ((event: CloseEvent) => void)[] = []
  private closedListeners: (() => void)[] = []

  private destroyed = false

  private readonly contents = {
    id: 1
  }

  get webContents() {
    if (this.destroyed) throw new TypeError('Object has been destroyed')
    return this.contents
  }

  on(event: 'close', listener: (event: CloseEvent) => void): void
  on(event: 'closed', listener: () => void): void
  on(event: 'close' | 'closed', listener: (event: CloseEvent) => void): void {
    if (event === 'close') {
      this.closeListeners = [...this.closeListeners, listener]
    } else {
      this.closedListeners = [
        ...this.closedListeners,
        () => listener({ preventDefault: () => undefined })
      ]
    }
  }

  emit(_event: 'closed'): void {
    for (const listener of this.closedListeners) listener()
  }

  destroyForTest(): void {
    this.destroyed = true
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  readonly close = vi.fn<() => void>()

  readonly hide = vi.fn<() => void>()

  requestClose() {
    const event = { preventDefault: vi.fn<() => void>() }
    for (const listener of this.closeListeners) listener(event)
    return event
  }
}

describe('registerWindowClosingHandlers', () => {
  it('user closes with a tray when drafts exist, then the window hides without saving', () => {
    const window = new TestWindow()
    const flushProviderDraft = vi.fn<(window: TestWindow) => Promise<void>>()
    registerWindowClosingHandlers({
      closingWindowIds: new Set(),
      flushProviderDraft,
      shouldKeepWindowOpen: () => true,
      window
    })

    const event = window.requestClose()

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(window.hide).toHaveBeenCalledOnce()
    expect(flushProviderDraft).not.toHaveBeenCalled()
  })

  it('user closes twice when drafts are saving, then the renderer stays until the save settles', async () => {
    const window = new TestWindow()
    const drain = Promise.withResolvers<void>()
    const flushProviderDraft = vi.fn<(window: TestWindow) => Promise<void>>(() => drain.promise)
    registerWindowClosingHandlers({
      closingWindowIds: new Set(),
      flushProviderDraft,
      shouldKeepWindowOpen: () => false,
      window
    })

    window.requestClose()
    const repeated = window.requestClose()
    expect(repeated.preventDefault).toHaveBeenCalledOnce()
    expect(window.close).not.toHaveBeenCalled()
    expect(flushProviderDraft).toHaveBeenCalledOnce()

    drain.resolve()
    await drain.promise
    expect(window.close).toHaveBeenCalledOnce()
    expect(window.requestClose().preventDefault).not.toHaveBeenCalled()
  })

  it('user closes when the renderer disappears during saving, then no destroyed window is closed', async () => {
    const window = new TestWindow()
    const drain = Promise.withResolvers<void>()
    registerWindowClosingHandlers({
      closingWindowIds: new Set(),
      flushProviderDraft: () => drain.promise,
      shouldKeepWindowOpen: () => false,
      window
    })
    window.requestClose()
    window.destroyForTest()
    drain.resolve()
    await drain.promise

    expect(window.close).not.toHaveBeenCalled()
  })

  it('user sees safe cleanup when the window is destroyed, then the closing set clears', () => {
    const window = new TestWindow()
    const closingWindowIds = new Set([1])
    registerWindowClosingHandlers({
      closingWindowIds,
      flushProviderDraft: async () => undefined,
      shouldKeepWindowOpen: () => false,
      window
    })

    window.destroyForTest()

    expect(() => window.emit('closed')).not.toThrow()
    expect(closingWindowIds).toEqual(new Set())
  })
})
