export const WINDOW_CLOSE_CHANNEL = 'window-controls:close'
export const WINDOW_FULLSCREEN_CHANGED_CHANNEL = 'window-controls:fullscreen-changed'
export const WINDOW_IS_FULLSCREEN_CHANNEL = 'window-controls:is-fullscreen'
export const WINDOW_IS_MAXIMIZED_CHANNEL = 'window-controls:is-maximized'
export const WINDOW_MAXIMIZE_CHANNEL = 'window-controls:maximize'
export const WINDOW_MAXIMIZED_CHANGED_CHANNEL = 'window-controls:maximized-changed'
export const WINDOW_MINIMIZE_CHANNEL = 'window-controls:minimize'
export const WINDOW_TOGGLE_FULLSCREEN_CHANNEL = 'window-controls:toggle-fullscreen'
export const WINDOW_UNMAXIMIZE_CHANNEL = 'window-controls:unmaximize'

export interface WindowControlsAPI {
  close: () => Promise<void>
  isFullScreen: () => Promise<boolean>
  isMaximized: () => Promise<boolean>
  maximize: () => Promise<void>
  minimize: () => Promise<void>
  onFullScreenChange: (listener: (isFullScreen: boolean) => void) => () => void
  onMaximizedChange: (listener: (isMaximized: boolean) => void) => () => void
  toggleFullScreen: () => Promise<void>
  unmaximize: () => Promise<void>
}
