import { IpcChannel } from '../../IpcChannel'
import type { IpcMethod } from '../contracts'
import * as z from 'zod'

import { defineSchema } from '../../data/define'
import { SessionTitleSchema, ProjectIdSchema } from '../../data/schemas/session'

interface SessionsAPI {
  create: IpcMethod<IpcChannel.Sessions_Create>
  delete: IpcMethod<IpcChannel.Sessions_Delete>
  list: IpcMethod<IpcChannel.Sessions_List>
  load: IpcMethod<IpcChannel.Sessions_Load>
  rename: IpcMethod<IpcChannel.Sessions_Rename>
  setThinkingEffort: IpcMethod<IpcChannel.Sessions_SetThinkingEffort>
  setModelEntry: IpcMethod<IpcChannel.Sessions_SetModelEntry>
  onTitleUpdated: (listener: (update: { sessionId: string; title: string }) => void) => () => void
}

const CreateSessionRequestSchema = defineSchema(
  z.object({ title: SessionTitleSchema, projectId: ProjectIdSchema.optional() })
)

export { CreateSessionRequestSchema, type SessionsAPI }
