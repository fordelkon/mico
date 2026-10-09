interface AppWithQuitEvents {
  quit: () => void
  on(event: 'before-quit', listener: (event: CloseEvent) => void): void
}

/** Keeps native Quit behind the renderer drain while allowing the resumed Quit through. */
function registerAppQuitHandler({
  app,
  dispose,
  prepareToQuit
}: {
  app: AppWithQuitEvents
  dispose: () => void
  prepareToQuit: () => Promise<void>
}): void {
  let isDraining = false
  let isReadyToQuit = false
  app.on('before-quit', (event) => {
    if (isReadyToQuit) return
    event.preventDefault()
    if (isDraining) return
    isDraining = true
    void (async () => {
      try {
        await prepareToQuit()
      } catch (error) {
        console.error('Failed to drain provider drafts before quitting', error)
      }
      try {
        dispose()
      } catch (error) {
        console.error('Failed to dispose application resources before quitting', error)
      } finally {
        isReadyToQuit = true
        app.quit()
      }
    })()
  })
}

type CloseEvent = {
  preventDefault: () => void
}

interface WindowWithLifecycleEvents {
  close: () => void
  hide: () => void
  isDestroyed: () => boolean
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
  let isClosing = false

  window.on('close', (event) => {
    if (closingWindowIds.has(windowId)) return
    event.preventDefault()
    if (shouldKeepWindowOpen()) {
      window.hide()
      return
    }
    if (isClosing) return
    isClosing = true
    // A repeated native close must keep the renderer alive until its drain settles.
    void (async () => {
      try {
        await flushProviderDraft(window)
      } catch (error) {
        console.error('Failed to drain provider drafts before closing the window', error)
      }
      if (window.isDestroyed()) return
      closingWindowIds.add(windowId)
      window.close()
    })()
  })
  window.on('closed', () => closingWindowIds.delete(windowId))
}

export { registerAppQuitHandler, registerWindowClosingHandlers }
