type CloseEvent = {
  preventDefault: () => void
}

interface WindowWithLifecycleEvents {
  close: () => void
  hide: () => void
  webContents: {
    id: number
  }
  on(event: 'close', listener: (event: CloseEvent) => void): void
  on(event: 'closed', listener: () => void): void
}

function registerWindowClosingHandlers<TWindow extends WindowWithLifecycleEvents>({
  closingWindowIds,
  flushProviderDraft,
  shouldKeepWindowOpen,
  window
}: {
  closingWindowIds: Set<number>
  flushProviderDraft: (window: TWindow) => Promise<void>
  shouldKeepWindowOpen: () => boolean
  window: TWindow
}): void {
  const windowId = window.webContents.id

  window.on('close', (event) => {
    if (!shouldKeepWindowOpen()) return

    event.preventDefault()
    window.hide()
  })

  window.on('close', (event) => {
    if (shouldKeepWindowOpen() || closingWindowIds.has(windowId)) return

    event.preventDefault()
    closingWindowIds.add(windowId)
    // Native close and Quit shortcuts bypass React navigation, so the main process owns this final draft boundary.
    void flushProviderDraft(window).finally(() => window.close())
  })
  window.on('closed', () => closingWindowIds.delete(windowId))
}

export { registerWindowClosingHandlers }
