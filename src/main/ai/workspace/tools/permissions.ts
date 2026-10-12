import type { PermissionMode } from '@shared/ai/permissions'
import type { ToolCall, ToolOperation } from './contract'
import { resolveWorkspacePath, type WorkspacePath } from './path-policy'

type ToolApprovalRequest = Readonly<ToolCall> & { cwd: string; reason: string }
type ToolPermissionOptions = {
  permissionMode?: PermissionMode
  requestApproval?: (request: ToolApprovalRequest, signal: AbortSignal) => Promise<boolean>
}

async function authorizeTool(
  call: ToolCall,
  cwd: string,
  signal: AbortSignal,
  operation: ToolOperation,
  options: ToolPermissionOptions,
  hookAskReason?: string
): Promise<void> {
  signal.throwIfAborted()
  const fileOperation =
    operation.kind === 'file-read' || operation.kind === 'file-write' ? operation : undefined
  const allowMissing = operation.kind === 'file-write' && operation.allowMissing
  let target: WorkspacePath | undefined
  if (fileOperation) {
    target = await resolveWorkspacePath(cwd, fileOperation.path, { allowMissing })
  }
  if (hookAskReason === undefined) {
    if (operation.kind === 'read-only' || operation.kind === 'file-read') return
    if (
      options.permissionMode === 'acceptEdits' &&
      operation.kind === 'file-write' &&
      !target?.isProtected
    )
      return
  }
  const reason =
    (hookAskReason !== undefined
      ? hookAskReason.trim() || 'A preToolUse hook requires your approval.'
      : undefined) ??
    (operation.kind === 'command'
      ? 'This command runs on your computer without a sandbox and may access files outside this workspace.'
      : target?.isProtected
        ? 'This operation changes a protected configuration path and requires your approval.'
        : 'This operation changes workspace files and requires your approval.')
  if (!options.requestApproval)
    throw new Error(
      `Permission required for ${call.toolName}. No approval interface is available; the operation was not executed.`
    )
  const approved = await options.requestApproval({ ...call, cwd, reason }, signal)
  signal.throwIfAborted()
  if (!approved)
    throw new Error(
      `Permission denied by the user for ${call.toolName}. The operation was not executed. Ask the user before attempting the same operation again.`
    )
  await target?.revalidate()
}

export { authorizeTool, type ToolPermissionOptions, type ToolApprovalRequest }
