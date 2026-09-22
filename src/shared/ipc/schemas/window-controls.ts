interface WindowControlsAPI {
  close: () => Promise<void>
  isFocused: () => Promise<boolean>
  isFullScreen: () => Promise<boolean>
  isMaximized: () => Promise<boolean>
  maximize: () => Promise<void>
  minimize: () => Promise<void>
  onFocusChange: (listener: (isFocused: boolean) => void) => () => void
  onFullScreenChange: (listener: (isFullScreen: boolean) => void) => () => void
  onMaximizedChange: (listener: (isMaximized: boolean) => void) => () => void
  onProviderDraftFlush: (listener: () => Promise<void>) => () => void
  toggleFullScreen: () => Promise<void>
  unmaximize: () => Promise<void>
}
export type { WindowControlsAPI }
