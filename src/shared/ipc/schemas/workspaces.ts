import { IpcChannel } from '../../IpcChannel'
import type { IpcMethod } from '../contracts'
interface WorkspacesAPI {
  addFromDialog: IpcMethod<IpcChannel.Workspaces_AddFromDialog>
  archive: IpcMethod<IpcChannel.Workspaces_Archive>
  list: IpcMethod<IpcChannel.Workspaces_List>
  reveal: IpcMethod<IpcChannel.Workspaces_Reveal>
  rename: IpcMethod<IpcChannel.Workspaces_Rename>
  setDefault: IpcMethod<IpcChannel.Workspaces_SetDefault>
}

export type { WorkspacesAPI }
