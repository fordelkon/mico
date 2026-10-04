import { IpcChannel } from '../../IpcChannel'
import type { IpcMethod } from '../contracts'
interface WindowControlsAPI {
  readonly platform: 'darwin' | 'win32' | 'linux'
  close: IpcMethod<IpcChannel.WindowControls_Close>
  isFocused: IpcMethod<IpcChannel.WindowControls_IsFocused>
  isFullScreen: IpcMethod<IpcChannel.WindowControls_IsFullscreen>
  isMaximized: IpcMethod<IpcChannel.WindowControls_IsMaximized>
  maximize: IpcMethod<IpcChannel.WindowControls_Maximize>
  minimize: IpcMethod<IpcChannel.WindowControls_Minimize>
  toggleFullScreen: IpcMethod<IpcChannel.WindowControls_ToggleFullscreen>
  unmaximize: IpcMethod<IpcChannel.WindowControls_Unmaximize>
  onFocusChange: (listener: (isFocused: boolean) => void) => () => void
  onFullScreenChange: (listener: (isFullScreen: boolean) => void) => () => void
  onMaximizedChange: (listener: (isMaximized: boolean) => void) => () => void
  onProviderDraftFlush: (listener: () => Promise<void>) => () => void
}
export type { WindowControlsAPI }
