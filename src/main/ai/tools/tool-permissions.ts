import { realpath } from 'node:fs/promises'
import { basename, relative, sep } from 'node:path'

import * as z from 'zod'

import type { PermissionMode } from '@shared/ai/permissions'
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
  isReadOnly: boolean,
  options: ToolPermissionOptions,
  hookAskReason?: string
): Promise<void> {
  signal.throwIfAborted()
  const filePath = ['Read', 'Write', 'Edit'].includes(call.toolName)
    ? z.object({ file_path: z.string() }).parse(call.input).file_path
    : undefined
  let protectedPath = false
  let approvedTarget: string | undefined
  if (filePath !== undefined) {
    const target = await resolveWorkspacePath(cwd, filePath, {
      allowMissing: call.toolName === 'Write'
    })
    approvedTarget = await resolveCanonicalPath(target, { allowMissing: call.toolName === 'Write' })
    protectedPath =
      isProtectedPath(cwd, target) || isProtectedPath(await realpath(cwd), approvedTarget)
  }
  if (hookAskReason === undefined && call.toolName !== 'Bash') {
    if (isReadOnly) return
    if (
      options.permissionMode === 'acceptEdits' &&
      ['Write', 'Edit'].includes(call.toolName) &&
      !protectedPath
    )
      return
  }
  const reason =
    (hookAskReason !== undefined
      ? hookAskReason.trim() || 'A preToolUse hook requires your approval.'
      : undefined) ??
    (call.toolName === 'Bash'
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
  if (approvedTarget && filePath !== undefined) {
    const target = await resolveWorkspacePath(cwd, filePath, {
      allowMissing: call.toolName === 'Write'
    })
    if (
      (await resolveCanonicalPath(target, { allowMissing: call.toolName === 'Write' })) !==
      approvedTarget
    )
      throw new Error(
        'The file target changed while waiting for approval. The operation was not executed. Review the new target and request approval again.'
      )
  }
}

export { authorizeTool, type ToolPermissionOptions, type ToolApprovalRequest }
