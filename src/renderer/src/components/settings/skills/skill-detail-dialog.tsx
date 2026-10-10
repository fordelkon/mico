import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Spinner
} from '@mico/ui'
import type { SkillCatalog, SkillDocument } from '@shared/ai/skills'
import { FileText, ScrollText } from 'lucide-react'
import * as React from 'react'
import { Markdown } from '../../markdown/markdown'
import { loadError, sourceLabels } from './skill-presentation'
import './skills-settings.css'

interface SkillDetailDialogProps {
  projectId: string
  skill: SkillCatalog['skills'][number]
  onClose: () => void
  onCloseAutoFocus: (event: Event) => void
}

function SkillDetailDialog({
  projectId,
  skill,
  onClose,
  onCloseAutoFocus
}: SkillDetailDialogProps): React.JSX.Element {
  const [mode, setMode] = React.useState<'preview' | 'code'>('preview')
  const [revision, setRevision] = React.useState(0)
  const [result, setResult] = React.useState<{
    revision: number
    document?: SkillDocument
    error?: string
  } | null>(null)
  React.useEffect(() => {
    let active = true
    void window.api.skills.readDocument({ projectId, skillId: skill.id }).then(
      (document) => {
        if (active) setResult({ revision, document })
      },
      (error) => {
        if (active)
          setResult({
            revision,
            error: loadError(error instanceof Error ? error.message : '', 'SKILL.md')
          })
      }
    )
    return () => {
      active = false
    }
  }, [projectId, revision, skill.id])
  const current = result?.revision === revision ? result : null

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className="skills-settings__dialog flex max-h-[calc(100dvh-3rem)] min-h-0 flex-col gap-5 overflow-hidden p-6 sm:max-w-[min(64rem,calc(100vw-3rem))]"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader className="min-w-0 shrink-0 pr-6">
          <div className="flex items-start gap-3">
            <ScrollText aria-hidden="true" className="mt-1 size-6 shrink-0 text-text-secondary" />
            <div className="min-w-0">
              <DialogTitle className="break-words text-xl font-semibold text-text-primary">
                {skill.name}
              </DialogTitle>
              <p className="mt-1 text-xs text-text-tertiary">{sourceLabels[skill.source]}</p>
              <DialogDescription
                className="mt-3 max-h-[min(20dvh,8rem)] overflow-y-auto break-words whitespace-pre-line text-sm text-text-secondary focus-visible:outline-2 focus-visible:outline-ring"
                tabIndex={0}
              >
                {skill.description}
              </DialogDescription>
              <p className="mt-2 text-xs text-text-tertiary">
                {skill.userInvocable
                  ? 'Available as a slash command.'
                  : 'Model only · unavailable as a slash command.'}
                {skill.disableModelInvocation ? ' Requires explicit invocation.' : ''}
              </p>
            </div>
          </div>
        </DialogHeader>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-primary">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-5 py-3">
            <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
              <FileText aria-hidden="true" className="size-4" />
              SKILL.md
            </span>
            <div className="flex gap-1" aria-label="File view mode">
              <Button
                type="button"
                size="sm"
                variant={mode === 'preview' ? 'secondary' : 'ghost'}
                aria-pressed={mode === 'preview'}
                onClick={() => setMode('preview')}
              >
                Preview
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === 'code' ? 'secondary' : 'ghost'}
                aria-pressed={mode === 'code'}
                onClick={() => setMode('code')}
              >
                Code
              </Button>
            </div>
          </div>
          <div
            className="min-h-0 min-w-0 overflow-y-auto"
            role="region"
            aria-label="SKILL.md content"
            tabIndex={0}
          >
            {!current ? (
              <div className="flex min-h-40 items-center justify-center">
                <Spinner aria-label="Loading SKILL.md" />
              </div>
            ) : current.error ? (
              <div className="flex flex-col items-start gap-3 p-5">
                <p role="alert" className="text-sm text-destructive">
                  {current.error}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setRevision((value) => value + 1)}
                >
                  Retry
                </Button>
              </div>
            ) : current.document ? (
              mode === 'code' ? (
                <pre
                  aria-label="SKILL.md source"
                  tabIndex={0}
                  className="overflow-x-auto p-5 font-mono text-xs leading-6 text-text-primary"
                >
                  <code>{current.document.content}</code>
                </pre>
              ) : (
                <div className="skills-settings__preview p-5 sm:p-6">
                  <Markdown isStreaming={false} text={current.document.body} />
                </div>
              )
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { SkillDetailDialog }
