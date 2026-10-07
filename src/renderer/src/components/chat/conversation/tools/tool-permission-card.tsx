import { Button } from '@mico/ui'
import * as React from 'react'

import type { ToolPermissionData } from '@shared/ai/permissions'
import type { ChatAPI } from '@shared/ipc/schemas/chat'
import { ToolTraceInputSchema } from '@shared/ai/tool-trace'

function ToolPermissionCard({
  permission,
  isActive,
  onRespond
}: {
  permission: ToolPermissionData
  isActive: boolean
  onRespond: ChatAPI['respondToPermission']
}): React.JSX.Element {
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const pending = isActive && permission.state === 'pending'
  const respond = async (decision: 'allow' | 'deny'): Promise<void> => {
    setSubmitting(true)
    setError(null)
    try {
      await onRespond({ approvalId: permission.approvalId, decision })
    } catch (cause) {
      setSubmitting(false)
      setError(
        `Could not answer this tool approval. ${cause instanceof Error ? cause.message : 'Return to the active conversation and try again.'}`
      )
    }
  }
  const parsedInput = ToolTraceInputSchema.safeParse(permission.input)
  const input = parsedInput.success ? parsedInput.data : undefined
  return (
    <div
      aria-label={`Approval for ${permission.toolName}`}
      className={
        pending
          ? 'space-y-3 rounded-lg border border-border-subtle bg-background p-3 text-foreground shadow-hairline'
          : 'px-2 py-1 text-text-tertiary'
      }
      role="group"
    >
      <p className={pending ? 'text-sm font-medium' : 'text-xs'} role="status">
        {pending
          ? permission.toolName === 'Bash'
            ? 'Allow Mico to run this command?'
            : `Allow Mico to use ${permission.toolName}?`
          : permission.state === 'pending' || permission.state === 'cancelled'
            ? 'Approval cancelled. The operation was not executed.'
            : permission.state === 'denied'
              ? 'Permission denied. The operation was not executed.'
              : 'Approved for this call.'}
      </p>
      {pending && (
        <>
          <div className="max-h-[min(20rem,40vh)] space-y-3 overflow-y-auto overscroll-contain">
            <p className="text-xs text-muted-foreground">{permission.reason}</p>
            <p className="break-all font-mono text-xs">{permission.cwd}</p>
            {input?.file_path !== undefined && (
              <p className="break-all font-mono text-xs">{input.file_path}</p>
            )}
            {input?.command !== undefined ? (
              <pre
                aria-label="Command"
                className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 font-mono text-xs"
              >
                {input.command}
              </pre>
            ) : input?.content !== undefined ? (
              <pre
                aria-label="Proposed file content"
                className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 font-mono text-xs"
              >
                {input.content || '(Empty file)'}
              </pre>
            ) : (
              <pre
                aria-label="Tool arguments"
                className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 font-mono text-xs"
              >
                {JSON.stringify(permission.input, null, 2)}
              </pre>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <Button
              disabled={submitting}
              onClick={() => void respond('deny')}
              size="sm"
              type="button"
              variant="outline"
            >
              Deny
            </Button>
            <Button
              disabled={submitting}
              onClick={() => void respond('allow')}
              size="sm"
              type="button"
            >
              Allow once
            </Button>
          </div>
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  )
}

export { ToolPermissionCard }
