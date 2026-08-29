import type { RouteDef } from '../define'
import { appearanceRequestSchemas } from './appearance'
import { windowControlsRequestSchemas } from './window-controls'

const ipcRequestSchemas = {
  ...appearanceRequestSchemas,
  ...windowControlsRequestSchemas
} satisfies Record<string, RouteDef>
type IpcRequestSchemas = typeof ipcRequestSchemas
type IpcRoute = keyof IpcRequestSchemas

export { ipcRequestSchemas, type IpcRequestSchemas, type IpcRoute }
