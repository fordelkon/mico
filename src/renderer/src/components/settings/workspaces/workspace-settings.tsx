import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  IconTooltipButton,
  Input,
  Separator,
  Spinner
} from '@mico/ui'
import { Archive, Check, FolderOpen, Pencil, PlusIcon, Star, X } from 'lucide-react'
import * as React from 'react'

import type { WorkspaceProject } from '@shared/data/schemas/workspace'

function WorkspaceSettings(): React.JSX.Element {
  const [projects, setProjects] = React.useState<WorkspaceProject[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [renamingId, setRenamingId] = React.useState<string | null>(null)
  const [renameDraft, setRenameDraft] = React.useState('')
  const [archiveProject, setArchiveProject] = React.useState<WorkspaceProject | null>(null)

  const loadProjects = React.useCallback(async (): Promise<void> => {
    setError(null)
    try {
      setProjects(await window.api.workspaces.list())
    } catch {
      setError('Workspaces could not be loaded. Try opening Workspace Settings again.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void window.api.workspaces.list().then(
      (loadedProjects) => {
        setProjects(loadedProjects)
        setIsLoading(false)
      },
      () => {
        setError('Workspaces could not be loaded. Try opening Workspace Settings again.')
        setIsLoading(false)
      }
    )
  }, [])

  const addProject = async (): Promise<void> => {
    setError(null)
    try {
      const project = await window.api.workspaces.addFromDialog()
      if (!project) return
      await loadProjects()
    } catch {
      setError('The selected folder could not be added. Choose an existing folder and try again.')
    }
  }
  const setDefault = async (projectId: string): Promise<void> => {
    setError(null)
    try {
      await window.api.workspaces.setDefault(projectId)
      await loadProjects()
    } catch {
      setError('The default workspace could not be changed. Try again.')
    }
  }
  const revealWorkspace = async (projectId: string): Promise<void> => {
    setError(null)
    try {
      await window.api.workspaces.reveal(projectId)
    } catch {
      setError('The workspace folder could not be opened. Try again.')
    }
  }
  const saveRename = async (projectId: string): Promise<void> => {
    const name = renameDraft.trim()
    if (!name) return
    setError(null)
    try {
      await window.api.workspaces.rename({ projectId, name })
      setRenamingId(null)
      await loadProjects()
    } catch {
      setError('The workspace name could not be changed. Try again.')
    }
  }
  const cancelRename = (): void => {
    setRenamingId(null)
    setRenameDraft('')
  }
  const confirmArchive = async (): Promise<void> => {
    if (!archiveProject) return
    setError(null)
    try {
      await window.api.workspaces.archive(archiveProject.id)
      setArchiveProject(null)
      await loadProjects()
    } catch {
      setError('The workspace could not be archived. Choose another default workspace first.')
    }
  }

  return (
    <div className="paper-canvas flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 px-8 py-6">
        <div className="flex items-center gap-2">
          <FolderOpen aria-hidden="true" className="size-5 text-text-secondary" />
          <h1 className="text-xl font-semibold text-text-primary">Workspaces</h1>
        </div>
      </header>
      <Separator className="bg-border-subtle" />
      <main className="min-h-0 flex-1 overflow-y-auto p-6 sm:p-8">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
          <section
            aria-labelledby="workspaces-card-heading"
            className="flex flex-col gap-3 rounded-2xl border border-border-subtle bg-surface-primary px-5 py-4 shadow-hairline"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2
                  className="text-base font-semibold text-text-primary"
                  id="workspaces-card-heading"
                >
                  Workspaces
                </h2>
              </div>
              <Button onClick={() => void addProject()} size="sm" type="button" variant="outline">
                <PlusIcon aria-hidden="true" />
                Add Workspace
              </Button>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {isLoading ? (
              <div className="flex min-h-36 items-center justify-center">
                <Spinner className="size-5 text-text-tertiary" />
              </div>
            ) : projects.length ? (
              projects.map((project) => (
                <section
                  className="rounded-2xl border border-border-subtle bg-card px-5 py-2 shadow-hairline"
                  key={project.id}
                >
                  {renamingId === project.id ? (
                    <div className="flex items-center gap-2">
                      <FolderOpen
                        aria-hidden="true"
                        className="size-4 shrink-0 text-text-secondary"
                      />
                      <Input
                        aria-label="Workspace name"
                        autoFocus
                        className="h-8 min-w-0 flex-1"
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void saveRename(project.id)
                          if (event.key === 'Escape') cancelRename()
                        }}
                        value={renameDraft}
                      />
                      <IconTooltipButton
                        icon={<Check aria-hidden="true" className="size-3.5" />}
                        label={`Save ${project.name} name`}
                        onClick={() => void saveRename(project.id)}
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                      />
                      <IconTooltipButton
                        icon={<X aria-hidden="true" className="size-3.5" />}
                        label={`Cancel renaming ${project.name}`}
                        onClick={cancelRename}
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <FolderOpen
                            aria-hidden="true"
                            className="size-4 shrink-0 text-text-secondary"
                          />
                          <h2 className="truncate text-sm font-semibold text-text-primary">
                            {project.name}
                          </h2>
                          {project.isDefault ? (
                            <span className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-accent px-2 py-0.5 text-[11px] text-accent-foreground">
                              <Star aria-hidden="true" className="size-3 fill-current" />
                              Default
                            </span>
                          ) : null}
                        </div>
                        <p
                          className="mt-0.5 truncate pl-6 text-[10px] leading-3 text-text-tertiary"
                          title={project.rootPath}
                        >
                          {project.rootPath}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <IconTooltipButton
                          aria-pressed={project.isDefault}
                          icon={
                            <Star
                              aria-hidden="true"
                              className={project.isDefault ? 'size-3.5 fill-current' : 'size-3.5'}
                            />
                          }
                          label={
                            project.isDefault
                              ? `${project.name} is the default workspace`
                              : `Set ${project.name} as default`
                          }
                          onClick={() => void setDefault(project.id)}
                          size="icon-xs"
                          type="button"
                          variant="ghost"
                        />
                        <IconTooltipButton
                          icon={<FolderOpen aria-hidden="true" className="size-3.5" />}
                          label={`Reveal ${project.name} in folder`}
                          onClick={() => void revealWorkspace(project.id)}
                          size="icon-xs"
                          type="button"
                          variant="ghost"
                        />
                        <IconTooltipButton
                          icon={<Pencil aria-hidden="true" className="size-3.5" />}
                          label={`Rename ${project.name}`}
                          onClick={() => {
                            setRenamingId(project.id)
                            setRenameDraft(project.name)
                          }}
                          size="icon-xs"
                          type="button"
                          variant="ghost"
                        />
                        <IconTooltipButton
                          disabled={project.isDefault}
                          icon={<Archive aria-hidden="true" className="size-3.5" />}
                          label={`Archive ${project.name}`}
                          onClick={() => setArchiveProject(project)}
                          size="icon-xs"
                          type="button"
                          variant="ghost"
                        />
                      </div>
                    </div>
                  )}
                </section>
              ))
            ) : (
              <p className="rounded-2xl border border-dashed border-border-subtle px-5 py-10 text-center text-sm text-text-tertiary">
                Add a local folder to start a workspace.
              </p>
            )}
          </section>
        </div>
      </main>
      <AlertDialog
        open={archiveProject !== null}
        onOpenChange={(open) => {
          if (!open) setArchiveProject(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {archiveProject?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes it from new-chat selection. Existing chats retain their saved folder.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmArchive()} variant="destructive">
              Archive workspace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export { WorkspaceSettings }
