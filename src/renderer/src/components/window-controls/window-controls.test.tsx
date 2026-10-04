import '@testing-library/jest-dom/vitest'

import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WindowControlsAPI } from '@shared/ipc/schemas/window-controls'

import { WindowControls } from './window-controls'

type FocusListener = (isFocused: boolean) => void

let focusListener: FocusListener | undefined

// Only members the component reads on mount; click handlers stay unexercised here.
const windowControls = {
  isFocused: vi.fn<WindowControlsAPI['isFocused']>(),
  isFullScreen: vi.fn<WindowControlsAPI['isFullScreen']>(),
  isMaximized: vi.fn<WindowControlsAPI['isMaximized']>(),
  onFocusChange: vi.fn<WindowControlsAPI['onFocusChange']>(),
  onFullScreenChange: vi.fn<WindowControlsAPI['onFullScreenChange']>(),
  onMaximizedChange: vi.fn<WindowControlsAPI['onMaximizedChange']>()
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
      value: { windowControls: { ...windowControls, platform: 'darwin' } }
    })
  })

  it('user sees the controls track focus when native focus changes, then colors update', async () => {
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
