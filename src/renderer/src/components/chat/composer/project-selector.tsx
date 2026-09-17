import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@mico/ui'
import { FolderIcon, FolderPlusIcon } from 'lucide-react'
import * as React from 'react'

import type { WorkspaceProject } from '@shared/data/schemas/workspace'

import { useGlidingHighlight } from '@renderer/hooks/use-gliding-highlight'

type ProjectSelectorProps = {
  canAddProject: boolean
  onAddProject?: () => Promise<void>
  onProjectSelected?: (project: WorkspaceProject) => void
  projectId?: string | null
  projectLabel?: string | null
  projectPath?: string | null
  projects: WorkspaceProject[]
}

function ProjectSelector({
  canAddProject,
  onAddProject,
  onProjectSelected,
  projectId,
  projectLabel,
  projectPath,
  projects
}: ProjectSelectorProps): React.JSX.Element | null {
  const { clearHighlight, getItemProps, highlightProps } = useGlidingHighlight<HTMLElement>()
  const canSelectProject = canAddProject && onAddProject && onProjectSelected

  if (!canAddProject && !projectLabel) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={
            projectLabel
              ? `Workspace: ${projectLabel}${projectPath ? ` (${projectPath})` : ''}`
              : 'Choose workspace'
          }
          className={projectLabel ? 'h-8 max-w-40 gap-1.5 px-2' : 'size-8'}
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
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-fit min-w-44 max-w-64 p-2" side="top">
        {canSelectProject ? (
          <>
            <DropdownMenuLabel className="px-2 py-1">Workspaces</DropdownMenuLabel>
            {projects.length ? (
              <div className="relative" onMouseLeave={clearHighlight}>
                <span
                  {...highlightProps}
                  className={`${highlightProps.className} inset-x-1 rounded-md bg-accent`}
                />
                <DropdownMenuRadioGroup
                  value={projectId ?? ''}
                  onValueChange={(id) => {
                    const project = projects.find((candidate) => candidate.id === id)
                    if (project) onProjectSelected(project)
                  }}
                >
                  {projects.map((project, index) => (
                    <DropdownMenuRadioItem
                      {...getItemProps(index)}
                      className="relative z-10 h-8 gap-2 px-2 py-1 pr-8 hover:bg-transparent focus:bg-transparent"
                      key={project.id}
                      value={project.id}
                    >
                      <FolderIcon aria-hidden="true" className="size-4" />
                      <span className="min-w-0 truncate font-medium">{project.name}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </div>
            ) : (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                No workspaces have been added yet.
              </p>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void onAddProject()}>
              <FolderPlusIcon aria-hidden="true" />
              Add workspace
            </DropdownMenuItem>
          </>
        ) : (
          <div className="grid gap-1 px-2 py-1.5" role="group" aria-label="Workspace">
            <p className="font-medium">{projectLabel}</p>
            <p className="pt-1 text-xs text-muted-foreground">
              This workspace is set for the current conversation.
            </p>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { ProjectSelector }
