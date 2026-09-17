import * as z from 'zod'

import { defineSchema } from '../define'

const WorkspaceProjectIdSchema = defineSchema(z.string().trim().min(1))
const WorkspaceProjectSchema = defineSchema(
  z.object({
    id: WorkspaceProjectIdSchema,
    name: z.string().trim().min(1),
    rootPath: z.string().trim().min(1),
    isDefault: z.boolean()
  })
)

type WorkspaceProject = z.infer<typeof WorkspaceProjectSchema>

export { WorkspaceProjectIdSchema, WorkspaceProjectSchema }
export type { WorkspaceProject }
