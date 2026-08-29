import type { RouteDef } from '../define'
import { appearanceRequestSchemas } from './appearance'
import { chatRequestSchemas } from './chat'
import { windowControlsRequestSchemas } from './window-controls'

const ipcRequestSchemas = {
  ...appearanceRequestSchemas,
  ...chatRequestSchemas,
  ...windowControlsRequestSchemas
} satisfies Record<string, RouteDef>
type IpcRequestSchemas = typeof ipcRequestSchemas
type IpcRoute = keyof IpcRequestSchemas

export { ipcRequestSchemas, type IpcRequestSchemas, type IpcRoute }
