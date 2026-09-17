import type { RouteDef } from '../define'
import { appearanceRequestSchemas } from './appearance'
import { chatIpcSchemas } from './chat'
import { providersRequestSchemas } from './providers'
import { sessionsRequestSchemas } from './sessions'
import { windowControlsRequestSchemas } from './window-controls'
import { workspacesRequestSchemas } from './workspaces'

const ipcRequestSchemas = {
  ...appearanceRequestSchemas,
  ...chatIpcSchemas,
  ...providersRequestSchemas,
  ...sessionsRequestSchemas,
  ...workspacesRequestSchemas,
  ...windowControlsRequestSchemas
} satisfies Record<string, RouteDef>
type IpcRequestSchemas = typeof ipcRequestSchemas
type IpcRoute = keyof IpcRequestSchemas

export { ipcRequestSchemas, type IpcRequestSchemas, type IpcRoute }
