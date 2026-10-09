import { EventEmitter } from 'node:events'
import { IpcChannel } from '@shared/IpcChannel'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerProviderDraftFlush } from './provider-draft-flush'

function createFlushFixture() {
  // Electron's native IPC/window objects are unavailable in the Node test process.
  const registrar = new EventEmitter()
  const contents = Object.assign(new EventEmitter(), {
    id: 1,
    isDestroyed: vi.fn<() => boolean>(() => false),
    send: vi.fn<(channel: string) => void>()
  })
  const window = {
    isDestroyed: vi.fn<() => boolean>(() => false),
    webContents: contents
  }
  const flush = registerProviderDraftFlush(registrar)
  return {
    contents,
    flush: () => flush(window),
    registrar,
    window
  }
}

afterEach(() => vi.useRealTimers())

describe('provider draft shutdown boundary', () => {
  it('user closes while quitting when a save is pending, then one acknowledgement drains both', async () => {
    vi.useFakeTimers()
    const fixture = createFlushFixture()
    const closing = fixture.flush()
    const quitting = fixture.flush()
    fixture.registrar.emit(IpcChannel.Providers_DraftFlushed, { sender: fixture.contents })
    const timerCountAfterAcknowledgement = vi.getTimerCount()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(timerCountAfterAcknowledgement).toBe(0)
    await expect(Promise.all([closing, quitting])).resolves.toEqual([undefined, undefined])
    expect(fixture.contents.send).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('user quits when another renderer acknowledges, then waits for the owning renderer', async () => {
    vi.useFakeTimers()
    const fixture = createFlushFixture()
    const settled = vi.fn<() => void>()
    const flushing = fixture.flush().then(settled)
    fixture.registrar.emit(IpcChannel.Providers_DraftFlushed, { sender: { id: 2 } })
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()

    fixture.registrar.emit(IpcChannel.Providers_DraftFlushed, { sender: fixture.contents })
    await flushing
    expect(settled).toHaveBeenCalledOnce()
  })

  it('user quits when the renderer never acknowledges, then exits after a bounded wait', async () => {
    vi.useFakeTimers()
    const fixture = createFlushFixture()
    const flushing = fixture.flush()

    await vi.advanceTimersByTimeAsync(1_000)

    await expect(flushing).resolves.toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('user quits when the window is already destroyed, then exits without sending', async () => {
    const fixture = createFlushFixture()
    fixture.window.isDestroyed.mockReturnValue(true)

    await expect(fixture.flush()).resolves.toBeUndefined()
    expect(fixture.contents.send).not.toHaveBeenCalled()
  })

  it('user quits when web contents are already destroyed, then exits without sending', async () => {
    const fixture = createFlushFixture()
    fixture.contents.isDestroyed.mockReturnValue(true)

    await expect(fixture.flush()).resolves.toBeUndefined()
    expect(fixture.contents.send).not.toHaveBeenCalled()
  })

  it('user quits when the renderer is destroyed mid-save, then releases the wait immediately', async () => {
    vi.useFakeTimers()
    const fixture = createFlushFixture()
    const flushing = fixture.flush()

    fixture.contents.emit('destroyed')

    await expect(flushing).resolves.toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('user quits when renderer delivery fails, then exits without a pending timeout', async () => {
    vi.useFakeTimers()
    const fixture = createFlushFixture()
    fixture.contents.send.mockImplementation(() => {
      throw new Error('Render frame was disposed')
    })

    await expect(fixture.flush()).resolves.toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })
})
