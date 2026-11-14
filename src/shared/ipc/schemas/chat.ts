import type { TurnStreamEvent } from '@mico/coding-agent/contracts'
import type { IpcChannel } from '../../IpcChannel'
import type { IpcMethod } from '../contracts'

interface ChatAPI {
  getCapabilities: IpcMethod<IpcChannel.Chat_GetCapabilities>
  getSkillCatalog: IpcMethod<IpcChannel.Chat_GetSkillCatalog>
  startTurn: IpcMethod<IpcChannel.Chat_StartTurn>
  abortTurn: IpcMethod<IpcChannel.Chat_AbortTurn>
  respondToPermission: IpcMethod<IpcChannel.Chat_RespondToPermission>
  onTurnEvent: (listener: (event: TurnStreamEvent) => void) => () => void
}

export type { ChatAPI }
