import { IpcChannel } from '../../IpcChannel'
import type { IpcMethod } from '../contracts'

interface SkillsAPI {
  list: IpcMethod<IpcChannel.Skills_List>
  readDocument: IpcMethod<IpcChannel.Skills_ReadDocument>
}

export type { SkillsAPI }
