import * as z from 'zod'

const PermissionModeSchema = z.enum(['default', 'acceptEdits'])
const PermissionResponseSchema = z.strictObject({
  approvalId: z.string().uuid(),
  decision: z.enum(['allow', 'deny'])
})
const ToolPermissionDataSchema = z.object({
  approvalId: z.string().uuid(),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  cwd: z.string().min(1),
  reason: z.string().min(1),
  input: z.record(z.string(), z.json()),
  state: z.enum(['pending', 'approved', 'denied', 'cancelled'])
})

type PermissionMode = z.infer<typeof PermissionModeSchema>
type PermissionResponse = z.infer<typeof PermissionResponseSchema>
type ToolPermissionData = z.infer<typeof ToolPermissionDataSchema>

export { PermissionModeSchema, PermissionResponseSchema, ToolPermissionDataSchema }
export type { PermissionMode, PermissionResponse, ToolPermissionData }
