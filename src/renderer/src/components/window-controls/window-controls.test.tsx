import '@testing-library/jest-dom/vitest'

import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WindowControls } from './window-controls'

type FocusListener = (isFocused: boolean) => void

let focusListener: FocusListener | undefined

const windowControls = {
  close: vi.fn(),
  isFocused: vi.fn(),
  isFullScreen: vi.fn(),
  isMaximized: vi.fn(),
  maximize: vi.fn(),
  minimize: vi.fn(),
  onFocusChange: vi.fn(),
  onFullScreenChange: vi.fn(),
  onMaximizedChange: vi.fn(),
  toggleFullScreen: vi.fn(),
  unmaximize: vi.fn()
}

describe('WindowControls', () => {
  beforeEach(() => {
    focusListener = undefined
    windowControls.isFocused.mockReset()
    windowControls.isFocused.mockResolvedValue(true)
    windowControls.isFullScreen.mockReset()
    windowControls.isFullScreen.mockResolvedValue(false)
    windowControls.isMaximized.mockReset()
    windowControls.isMaximized.mockResolvedValue(false)
    windowControls.onFocusChange.mockReset()
    windowControls.onFocusChange.mockImplementation((listener: FocusListener) => {
      focusListener = listener
      return () => undefined
    })
    windowControls.onFullScreenChange.mockReset()
    windowControls.onFullScreenChange.mockReturnValue(() => undefined)
    windowControls.onMaximizedChange.mockReset()
    windowControls.onMaximizedChange.mockReturnValue(() => undefined)

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { windowControls }
    })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { process: { platform: 'darwin' } }
    })
  })

  it('uses native focus changes to restore traffic-light colors after a fullscreen handoff', async () => {
    render(<WindowControls />)

    const controls = screen.getByRole('banner', { name: 'Window controls' })
    await act(async () => undefined)

    expect(windowControls.isFocused).toHaveBeenCalledOnce()
    expect(focusListener).toBeDefined()
    expect(controls).toHaveAttribute('data-window-focused', 'true')

    act(() => {
      focusListener?.(false)
    })
    expect(controls).toHaveAttribute('data-window-focused', 'false')

    act(() => {
      focusListener?.(true)
    })

    expect(controls).toHaveAttribute('data-window-focused', 'true')
  })
})
