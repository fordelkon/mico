import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  SearchPopover
} from '@mico/ui'
import { FolderIcon, FolderPlusIcon } from 'lucide-react'
import * as React from 'react'

import type { WorkspaceProject } from '@shared/data/schemas/workspace'

import { useGlidingHighlight } from '@renderer/hooks/use-gliding-highlight'

type ProjectSelectorProps = {
  canAddProject: boolean
  onAddProject?: () => Promise<void>
  onProjectSelected?: (project: WorkspaceProject) => void
  onProjectsRefresh?: () => Promise<void>
  projectId?: string | null
  projectLabel?: string | null
  projectPath?: string | null
  projects: WorkspaceProject[]
}

function ProjectSelector({
  canAddProject,
  onAddProject,
  onProjectSelected,
  onProjectsRefresh,
  projectId,
  projectLabel,
  projectPath,
  projects
}: ProjectSelectorProps): React.JSX.Element | null {
  const { clearHighlight, getItemProps, highlightProps } = useGlidingHighlight<HTMLElement>()
  const canSelectProject = canAddProject && onAddProject && onProjectSelected
  const refreshProjects = (): void => {
    if (!canSelectProject || !onProjectsRefresh) return

    void onProjectsRefresh().catch(() => undefined)
  }

  if (!canAddProject && !projectLabel) return null

  const trigger = (
    <Button
      aria-label={
        projectLabel
          ? `Workspace: ${projectLabel}${projectPath ? ` (${projectPath})` : ''}`
          : 'Choose workspace'
      }
      className={projectLabel ? 'h-8 max-w-40 gap-1.5 px-2' : 'size-8'}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') refreshProjects()
      }}
      onPointerDown={refreshProjects}
      title={projectPath ?? undefined}
      type="button"
      variant="ghost"
    >
      {projectLabel ? (
        <>
          <FolderIcon aria-hidden="true" />
          <span className="min-w-0 truncate">{projectLabel}</span>
        </>
      ) : (
        <FolderPlusIcon aria-hidden="true" />
      )}
    </Button>
  )

  if (canSelectProject) {
    return (
      <SearchPopover
        align="start"
        contentClassName="w-56 max-w-[calc(100vw-2rem)]"
        searchLabel="Search workspaces"
        searchPlaceholder="Search workspaces"
        side="top"
        trigger={trigger}
      >
        {({ close, query }) => {
          const normalizedQuery = query.trim().toLocaleLowerCase()
          const visibleProjects = normalizedQuery
            ? projects.filter(({ name, rootPath }) =>
                [name, rootPath].some((value) =>
                  value.toLocaleLowerCase().includes(normalizedQuery)
                )
              )
            : projects

          return (
            <>
              {visibleProjects.length ? (
                <div
                  aria-label="Available workspaces"
                  className="relative max-h-[min(20rem,calc(var(--radix-popover-content-available-height)-5.5rem))] overflow-y-auto p-1"
                  onMouseLeave={clearHighlight}
                  role="listbox"
                >
                  <span
                    {...highlightProps}
                    className={`${highlightProps.className} inset-x-1 rounded-md bg-accent`}
                  />
                  {visibleProjects.map((project, index) => (
                    <Button
                      {...getItemProps(index)}
                      aria-label={project.name}
                      aria-selected={project.id === projectId}
                      className="relative z-10 h-auto min-h-9 w-full justify-start gap-2 px-2 py-1 text-left hover:bg-transparent focus-visible:border-transparent focus-visible:bg-transparent focus-visible:ring-0"
                      key={project.id}
                      onClick={() => {
                        onProjectSelected(project)
                        close()
                      }}
                      role="option"
                      type="button"
                      variant="ghost"
                    >
                      <FolderIcon aria-hidden="true" className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{project.name}</span>
                        <span
                          className="block truncate text-[10px] leading-3 text-muted-foreground"
                          title={project.rootPath}
                        >
                          {project.rootPath}
                        </span>
                      </span>
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="px-3 py-3 text-xs text-muted-foreground">
                  {projects.length
                    ? 'No workspaces match your search.'
                    : 'No workspaces have been added yet.'}
                </p>
              )}
              <div className="border-t border-border/70 p-1">
                <Button
                  className="w-full justify-start"
                  onClick={() => void onAddProject()}
                  type="button"
                  variant="ghost"
                >
                  <FolderPlusIcon aria-hidden="true" />
                  Add workspace
                </Button>
              </div>
            </>
          )
        }}
      </SearchPopover>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-fit min-w-44 max-w-64 p-2" side="top">
        <div className="grid gap-1 px-2 py-1.5" role="group" aria-label="Workspace">
          <p className="font-medium">{projectLabel}</p>
          <p className="pt-1 text-xs text-muted-foreground">
            This workspace is set for the current conversation.
          </p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { ProjectSelector }
