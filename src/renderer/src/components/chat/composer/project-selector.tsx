import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  SearchPopover,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@mico/ui'
import { ChevronDownIcon, FolderIcon, FolderPlusIcon } from 'lucide-react'
import * as React from 'react'

import type { WorkspaceProject } from '@shared/data/schemas/workspace'

import { useGlidingHighlight } from '@renderer/hooks/use-gliding-highlight'

import { handleComposerListNavigation } from './composer-list-navigation'

type ProjectSelectorProps = {
  canAddProject: boolean
  disabled?: boolean
  /**
   * `pill` renders the trigger as a bordered chip for placement outside the
   * composer surface; the default ghost treatment belongs inside control rows.
   */
  appearance?: 'ghost' | 'pill'
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
  disabled = false,
  appearance = 'ghost',
  onAddProject,
  onProjectSelected,
  onProjectsRefresh,
  projectId,
  projectLabel,
  projectPath,
  projects
}: ProjectSelectorProps): React.JSX.Element | null {
  const { clearHighlight, getItemProps, highlightProps } = useGlidingHighlight<HTMLElement>()
  // The open state is owned here so the shared tooltip can be suppressed while
  // a menu is open instead of stacking two floating layers on one trigger.
  const [menuOpen, setMenuOpen] = React.useState(false)
  const isPill = appearance === 'pill'
  const canSelectProject = canAddProject && onAddProject && onProjectSelected
  const refreshProjects = (): void => {
    if (disabled || !canSelectProject || !onProjectsRefresh) return

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
      className={
        projectLabel
          ? isPill
            ? 'h-7 max-w-full gap-1.5 rounded-full bg-surface-primary px-2.5 text-xs font-normal text-text-secondary'
            : 'h-8 max-w-full gap-1.5 px-2 text-xs font-normal text-text-secondary'
          : isPill
            ? 'size-7'
            : 'size-8'
      }
      disabled={disabled}
      onKeyDown={(event) => {
        if (
          (event.key === 'Enter' || event.key === ' ') &&
          !event.shiftKey &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.nativeEvent.isComposing
        )
          refreshProjects()
      }}
      onPointerDown={refreshProjects}
      type="button"
      variant={isPill ? 'outline' : 'ghost'}
    >
      {projectLabel ? (
        <>
          <FolderIcon aria-hidden="true" />
          <span className="min-w-0 truncate">{projectLabel}</span>
          <ChevronDownIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
        </>
      ) : (
        <FolderPlusIcon aria-hidden="true" />
      )}
    </Button>
  )

  const hasTooltip = Boolean(projectLabel)
  const triggerWithTooltip = hasTooltip ? (
    <TooltipTrigger asChild>{trigger}</TooltipTrigger>
  ) : (
    trigger
  )

  const menu = canSelectProject ? (
    <div
      className="chat-project-selector min-w-0 max-w-[18rem]"
      onKeyDownCapture={handleComposerListNavigation}
    >
      <SearchPopover
        align="start"
        contentClassName="w-56 max-w-[calc(100vw-2rem)]"
        open={menuOpen}
        onOpenChange={setMenuOpen}
        searchLabel="Search workspaces"
        searchPlaceholder="Search workspaces"
        side="top"
        trigger={triggerWithTooltip}
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
                      disabled={disabled}
                      onClick={() => {
                        if (disabled) return
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
                  disabled={disabled}
                  onClick={() => {
                    if (!disabled) void onAddProject()
                  }}
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
    </div>
  ) : (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>{triggerWithTooltip}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-fit min-w-44 max-w-64 p-2" side="top">
        <div className="grid gap-1 px-2 py-1.5" role="group" aria-label="Workspace">
          <p className="font-medium">{projectLabel}</p>
          {projectPath ? (
            <p className="break-all text-xs text-muted-foreground">{projectPath}</p>
          ) : null}
          <p className="pt-1 text-xs text-muted-foreground">
            This workspace is set for the current conversation.
          </p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  if (!hasTooltip) return menu

  return (
    <TooltipProvider delayDuration={500}>
      <Tooltip open={menuOpen ? false : undefined}>
        {menu}
        {menuOpen ? null : (
          <TooltipContent align="start" side="bottom">
            {`Workspace: ${projectLabel}`}
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  )
}

export { ProjectSelector }
