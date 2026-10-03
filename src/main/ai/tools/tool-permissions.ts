import { realpath } from 'node:fs/promises'
import { basename, relative, sep } from 'node:path'

import type { PermissionMode } from '@shared/ai/permissions'
import type { ToolOperation } from './tool-contract'
import type { ToolCall } from './tool-registry'
import { resolveCanonicalPath, resolveWorkspacePath } from './workspace-path-policy'

type ToolApprovalRequest = Readonly<ToolCall> & { cwd: string; reason: string }
type ToolPermissionOptions = {
  permissionMode?: PermissionMode
  requestApproval?: (request: ToolApprovalRequest, signal: AbortSignal) => Promise<boolean>
}

const PROTECTED_DIRECTORIES = new Set(['.git', '.mico', '.claude', '.vscode'])
const PROTECTED_FILES = new Set([
  '.bashrc',
  '.bash_profile',
  '.bash_login',
  '.bash_logout',
  '.profile',
  '.zshrc',
  '.zprofile',
  '.zshenv',
  '.zlogin',
  '.zlogout',
  'config.fish'
])

function isProtectedPath(cwd: string, path: string): boolean {
  const segments = relative(cwd, path).split(sep)
  const name = basename(path).toLowerCase()
  return (
    segments.some((segment) => PROTECTED_DIRECTORIES.has(segment.toLowerCase())) ||
    name === '.env' ||
    name.startsWith('.env.') ||
    PROTECTED_FILES.has(name)
  )
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
  let protectedPath = false
  let approvedTarget: string | undefined
  if (fileOperation) {
    const target = await resolveWorkspacePath(cwd, fileOperation.path, { allowMissing })
    approvedTarget = await resolveCanonicalPath(target, { allowMissing })
    protectedPath =
      isProtectedPath(cwd, target) || isProtectedPath(await realpath(cwd), approvedTarget)
  }
  if (hookAskReason === undefined) {
    if (operation.kind === 'read-only' || operation.kind === 'file-read') return
    if (
      options.permissionMode === 'acceptEdits' &&
      operation.kind === 'file-write' &&
      !protectedPath
    )
      return
  }
  const reason =
    (hookAskReason !== undefined
      ? hookAskReason.trim() || 'A preToolUse hook requires your approval.'
      : undefined) ??
    (operation.kind === 'command'
      ? 'This command runs on your computer without a sandbox and may access files outside this workspace.'
      : protectedPath
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
  if (approvedTarget && fileOperation) {
    const target = await resolveWorkspacePath(cwd, fileOperation.path, { allowMissing })
    if ((await resolveCanonicalPath(target, { allowMissing })) !== approvedTarget)
      throw new Error(
        'The file target changed while waiting for approval. The operation was not executed. Review the new target and request approval again.'
      )
  }
}

export { authorizeTool, type ToolPermissionOptions, type ToolApprovalRequest }
