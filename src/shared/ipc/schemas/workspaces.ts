import * as z from 'zod'

import { WorkspaceProjectSchema } from '../../data/schemas/workspace'

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

export type { WorkspacesAPI }
