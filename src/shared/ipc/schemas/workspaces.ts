import * as z from 'zod'

import { WorkspaceProjectIdSchema, WorkspaceProjectSchema } from '../../data/schemas/workspace'
import { defineRoute } from '../define'

interface WorkspacesAPI {
  addFromDialog: () => Promise<z.infer<typeof WorkspaceProjectSchema> | undefined>
  archive: (projectId: string) => Promise<void>
  list: () => Promise<Array<z.infer<typeof WorkspaceProjectSchema>>>
  reveal: (projectId: string) => Promise<void>
  rename: (input: {
    projectId: string
    name: string
  }) => Promise<z.infer<typeof WorkspaceProjectSchema>>
  setDefault: (projectId: string) => Promise<z.infer<typeof WorkspaceProjectSchema>>
}

const workspacesRequestSchemas = {
  'workspaces.add-from-dialog': defineRoute({
    input: z.void(),
    output: WorkspaceProjectSchema.optional()
  }),
  'workspaces.archive': defineRoute({ input: WorkspaceProjectIdSchema, output: z.void() }),
  'workspaces.list': defineRoute({ input: z.void(), output: z.array(WorkspaceProjectSchema) }),
  'workspaces.rename': defineRoute({
    input: z.object({
      projectId: WorkspaceProjectIdSchema,
      name: z.string().trim().min(1).max(200)
    }),
    output: WorkspaceProjectSchema
  }),
  'workspaces.reveal': defineRoute({ input: WorkspaceProjectIdSchema, output: z.void() }),
  'workspaces.set-default': defineRoute({
    input: WorkspaceProjectIdSchema,
    output: WorkspaceProjectSchema
  })
}

export { workspacesRequestSchemas, type WorkspacesAPI }
