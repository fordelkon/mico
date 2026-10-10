import { Button, InputGroup, InputGroupAddon, InputGroupInput, Separator, Spinner } from '@mico/ui'
import type { SkillCatalog } from '@shared/ai/skills'
import type { WorkspaceProject } from '@shared/data/schemas/workspace'
import { RefreshCw, ScrollText, Search } from 'lucide-react'
import * as React from 'react'
import { SkillDetailDialog } from './skill-detail-dialog'
import { loadError, sourceLabels } from './skill-presentation'
import './skills-settings.css'

type Skill = SkillCatalog['skills'][number]

function SkillsSettings({ initialProjectId }: { initialProjectId?: string }): React.JSX.Element {
  const [revision, setRevision] = React.useState(0)
  const [workspaceResult, setWorkspaceResult] = React.useState<{
    revision: number
    projects?: WorkspaceProject[]
    error?: string
  } | null>(null)
  React.useEffect(() => {
    let active = true
    void window.api.workspaces.list().then(
      (projects) => {
        if (active) setWorkspaceResult({ revision, projects })
      },
      (error) => {
        if (active)
          setWorkspaceResult({
            revision,
            error: loadError(error instanceof Error ? error.message : '', 'Workspaces')
          })
      }
    )
    return () => {
      active = false
    }
  }, [revision])
  const currentWorkspaces = workspaceResult?.revision === revision ? workspaceResult : null
  const projects = currentWorkspaces?.projects ?? []
  const projectId =
    projects.find(({ id }) => id === initialProjectId)?.id ??
    projects.find(({ isDefault }) => isDefault)?.id ??
    projects[0]?.id
  const [query, setQuery] = React.useState('')
  const [selection, setSelection] = React.useState<{ projectId: string; skill: Skill } | null>(null)
  const selectedSkill = selection && selection.projectId === projectId ? selection.skill : null
  const [result, setResult] = React.useState<{
    projectId: string
    revision: number
    catalog?: SkillCatalog
    error?: string
  } | null>(null)
  const selectedButton = React.useRef<HTMLButtonElement | null>(null)

  React.useEffect(() => {
    if (!projectId) return
    let active = true
    void window.api.skills.list({ projectId }).then(
      (catalog) => {
        if (active) setResult({ projectId, revision, catalog })
      },
      (error) => {
        if (active)
          setResult({
            projectId,
            revision,
            error: loadError(error instanceof Error ? error.message : '', 'Skills')
          })
      }
    )
    return () => {
      active = false
    }
  }, [projectId, revision])
  const current =
    result && result.projectId === projectId && result.revision === revision ? result : null
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const skills = (current?.catalog?.skills ?? []).filter(({ name, description }) =>
    `${name} ${description}`.toLocaleLowerCase().includes(normalizedQuery)
  )
  const refresh = (): void => {
    setSelection(null)
    setRevision((value) => value + 1)
  }
  const restoreFocus = (event: Event): void => {
    event.preventDefault()
    selectedButton.current?.focus({ preventScroll: true })
  }

  return (
    <div className="paper-canvas flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 px-8 py-6">
        <div className="flex items-center gap-2">
          <ScrollText aria-hidden="true" className="size-5 text-text-secondary" />
          <h1 className="text-xl font-semibold text-text-primary">Skills</h1>
        </div>
      </header>
      <Separator className="bg-border-subtle" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col p-6">
        <section
          aria-label="Skill catalog"
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-primary shadow-sm"
        >
          <div className="skills-settings__content flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
            <section
              className="flex flex-wrap items-center gap-3"
              aria-label="Skill catalog controls"
            >
              <InputGroup className="min-w-0 flex-1 basis-48">
                <InputGroupAddon>
                  <Search aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  aria-label="Search skills"
                  placeholder="Search skills..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </InputGroup>
              <Button
                variant="outline"
                size="sm"
                type="button"
                disabled={!currentWorkspaces}
                onClick={refresh}
              >
                <RefreshCw aria-hidden="true" />
                Refresh
              </Button>
            </section>
            {!currentWorkspaces ? (
              <div className="flex min-h-40 items-center justify-center">
                <Spinner aria-label="Loading workspaces" />
              </div>
            ) : currentWorkspaces.error ? (
              <div className="flex flex-col items-start gap-3">
                <p role="alert" className="text-sm text-destructive">
                  {currentWorkspaces.error}
                </p>
                <Button type="button" variant="outline" size="sm" onClick={refresh}>
                  Retry
                </Button>
              </div>
            ) : !projectId ? (
              <p className="py-10 text-center text-sm text-text-tertiary">
                Add a workspace in Workspace Settings to browse skills.
              </p>
            ) : !current ? (
              <div className="flex min-h-40 items-center justify-center">
                <Spinner aria-label="Loading skills" />
              </div>
            ) : current.error ? (
              <div className="flex flex-col items-start gap-3">
                <p role="alert" className="text-sm text-destructive">
                  {current.error}
                </p>
                <Button type="button" variant="outline" size="sm" onClick={refresh}>
                  Retry
                </Button>
              </div>
            ) : (
              <>
                <p className="text-xs text-text-tertiary">
                  {current.catalog?.skills.length ?? 0} skills · Workspace and user skills
                </p>
                <div className="flex flex-col gap-1">
                  {skills.map((skill) => (
                    <button
                      key={skill.id}
                      aria-label={`View ${skill.name}`}
                      type="button"
                      className="flex min-w-0 items-start gap-3 rounded-lg p-3 text-left hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                      onClick={(event) => {
                        selectedButton.current = event.currentTarget
                        setSelection({ projectId, skill })
                      }}
                    >
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-text-secondary">
                        <ScrollText aria-hidden="true" className="size-5" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="break-words text-sm font-semibold text-text-primary">
                          {skill.name}
                        </span>
                        <span className="line-clamp-2 break-words text-sm text-text-secondary">
                          {skill.description}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-tertiary">
                          <span>{sourceLabels[skill.source]}</span>
                          {!skill.userInvocable ? <span>Model only</span> : null}
                          {skill.disableModelInvocation ? <span>Explicit invocation</span> : null}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
                {!skills.length ? (
                  <p className="py-10 text-center text-sm text-text-tertiary">
                    {current.catalog?.skills.length
                      ? 'No matching skills.'
                      : 'No skills found in this workspace.'}
                  </p>
                ) : null}
                {current.catalog?.diagnostics.length ? (
                  <details className="rounded-2xl border border-border-subtle bg-card p-5">
                    <summary className="cursor-pointer text-sm text-text-secondary">
                      Discovery notices ({current.catalog.diagnostics.length})
                    </summary>
                    <ul className="mt-3 flex flex-col gap-3">
                      {current.catalog.diagnostics.map(({ path, source, message }, index) => (
                        <li
                          key={`${path}:${index}`}
                          className="break-words text-xs text-text-secondary"
                        >
                          <p className="font-medium">
                            {sourceLabels[source]} · {path}
                          </p>
                          <p className="mt-1">{message}</p>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </>
            )}
          </div>
        </section>
      </div>
      {selectedSkill && projectId ? (
        <SkillDetailDialog
          key={`${projectId}:${selectedSkill.id}`}
          projectId={projectId}
          skill={selectedSkill}
          onClose={() => setSelection(null)}
          onCloseAutoFocus={restoreFocus}
        />
      ) : null}
    </div>
  )
}

export { SkillsSettings }
