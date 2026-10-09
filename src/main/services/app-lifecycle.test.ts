import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

import { registerAppQuitHandler } from './window-lifecycle'

function createQuitFixture(prepareToQuit: () => Promise<void>) {
  // Electron's native application event loop is the external seam.
  const app = Object.assign(new EventEmitter(), {
    quit: vi.fn<() => void>(() => app.emit('before-quit', event))
  })
  const event = { preventDefault: vi.fn<() => void>() }
  const dispose = vi.fn<() => void>()
  registerAppQuitHandler({ app, dispose, prepareToQuit })
  return { app, dispose, event }
}

describe('application quit lifecycle', () => {
  it('user quits with pending drafts when quit repeats, then releases resources only after saving', async () => {
    const drain = Promise.withResolvers<void>()
    const prepareToQuit = vi.fn<() => Promise<void>>(() => drain.promise)
    const fixture = createQuitFixture(prepareToQuit)

    fixture.app.emit('before-quit', fixture.event)
    fixture.app.emit('before-quit', fixture.event)
    expect(fixture.event.preventDefault).toHaveBeenCalledTimes(2)
    expect(prepareToQuit).toHaveBeenCalledOnce()
    expect(fixture.dispose).not.toHaveBeenCalled()

    drain.resolve()
    await drain.promise
    await Promise.resolve()
    expect(fixture.dispose).toHaveBeenCalledOnce()
    expect(fixture.app.quit).toHaveBeenCalledOnce()
    expect(fixture.event.preventDefault).toHaveBeenCalledTimes(2)
  })

  it('user quits without a renderer when the drain resolves, then resources close once', async () => {
    const fixture = createQuitFixture(async () => undefined)

    fixture.app.emit('before-quit', fixture.event)
    await Promise.resolve()
    await Promise.resolve()

    expect(fixture.dispose).toHaveBeenCalledOnce()
    expect(fixture.app.quit).toHaveBeenCalledOnce()
  })

  it('user quits when resource disposal fails, then native shutdown still resumes', async () => {
    const fixture = createQuitFixture(async () => undefined)
    fixture.dispose.mockImplementation(() => {
      throw new Error('Resource already closed')
    })
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      fixture.app.emit('before-quit', fixture.event)
      await Promise.resolve()
      await Promise.resolve()

      expect(fixture.app.quit).toHaveBeenCalledOnce()
      expect(log).toHaveBeenCalledWith(
        'Failed to dispose application resources before quitting',
        expect.any(Error)
      )
    } finally {
      log.mockRestore()
    }
  })

  it('user quits when draft preparation fails, then shutdown still completes', async () => {
    const drain = Promise.withResolvers<void>()
    const fixture = createQuitFixture(() => drain.promise)
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      fixture.app.emit('before-quit', fixture.event)
      drain.reject(new Error('Renderer unavailable'))
      await drain.promise.catch(() => undefined)
      await Promise.resolve()

      expect(fixture.dispose).toHaveBeenCalledOnce()
      expect(fixture.app.quit).toHaveBeenCalledOnce()
      expect(log).toHaveBeenCalledWith(
        'Failed to drain provider drafts before quitting',
        expect.any(Error)
      )
    } finally {
      log.mockRestore()
    }
  })
})
