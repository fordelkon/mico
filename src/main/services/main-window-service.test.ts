import { describe, expect, it } from 'vitest'

import { registerWindowClosingHandlers } from './window-lifecycle'

type Listener = (...args: never[]) => void

class TestWindow {
  private readonly listeners = new Map<string, Listener[]>()

  private destroyed = false

  private readonly contents = {
    id: 1
  }

  get webContents() {
    if (this.destroyed) throw new TypeError('Object has been destroyed')
    return this.contents
  }

  on(event: string, listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }

  emit(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) listener()
  }

  destroyForTest(): void {
    this.destroyed = true
  }

  close(): void {}

  hide(): void {}
}

describe('registerWindowClosingHandlers', () => {
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
