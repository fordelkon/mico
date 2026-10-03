import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'

import { IpcChannel } from '@shared/IpcChannel'
import { registerChannel } from './define-channel'

declare const registrar: Pick<IpcMain, 'handle'>
declare const windowOf: (event: IpcMainInvokeEvent) => BrowserWindow

registerChannel(registrar, windowOf, {
  channel: IpcChannel.WindowControls_IsFocused,
  // @ts-expect-error This task must return a boolean, even when another task returns text.
  handle: () => 'focused'
})

registerChannel(registrar, windowOf, {
  channel: IpcChannel.Sessions_Rename,
  // @ts-expect-error The channel selects the request contract, not the handler parameter.
  handle: (input: { projectId: string; name: string }) => input
})
