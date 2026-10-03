import {
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  Spinner
} from '@mico/ui'
import { ChevronRight, FolderOpen } from 'lucide-react'
import * as React from 'react'

import type { Conversation } from '@renderer/types/chat'
import type { WorkspaceProject } from '@shared/data/schemas/workspace'
import { useGlidingHighlight } from '@renderer/hooks/use-gliding-highlight'
import { ConversationRow } from './conversation-row'

type ConversationNavigationProps = {
  conversations: Conversation[]
  projects: WorkspaceProject[]
  activeConversationId: string | null
  respondingConversationIds: ReadonlySet<string>
  commandKeyPressed: boolean
  selectionRequest: { id: string; key: number } | null
  onDeleteConversation: (id: string) => void
  onRenameConversation: (id: string, title: string) => void
  onSelectConversation: (id: string, options?: { focusComposer?: boolean }) => void
}

type ConversationGroup = {
  id: string
  name: string
  path: string | null
  isDefault: boolean
  conversations: Conversation[]
}

function latestActivity(conversations: Conversation[]): number {
  return conversations.reduce(
    (latest, { lastActivityAt }) => Math.max(latest, lastActivityAt ?? 0),
    0
  )
}

function ConversationList({
  conversations,
  activeConversationId,
  respondingConversationIds,
  commandKeyPressed,
  onDeleteConversation,
  onRenameConversation,
  onSelectConversation,
  shortcutIndexes
}: Omit<ConversationNavigationProps, 'projects'> & {
  shortcutIndexes: ReadonlyMap<string, number>
}): React.JSX.Element {
  const highlight = useGlidingHighlight<HTMLLIElement>()
  return (
    <SidebarMenu className="relative" onMouseLeave={highlight.clearHighlight}>
      <span
        {...highlight.highlightProps}
        className={`${highlight.highlightProps.className} inset-x-1.5 rounded-lg bg-sidebar-row-hover`}
      />
      {conversations.map((conversation, index) => (
        <ConversationRow
          key={conversation.id}
          conversation={conversation}
          isResponding={respondingConversationIds.has(conversation.id)}
          shortcutNumber={commandKeyPressed ? shortcutIndexes.get(conversation.id) : undefined}
          selected={conversation.id === activeConversationId}
          onDeleteConversation={onDeleteConversation}
          onRenameConversation={onRenameConversation}
          onSelectConversation={onSelectConversation}
          glidingHighlightItemProps={highlight.getItemProps(index)}
        />
      ))}
    </SidebarMenu>
  )
}

function ProjectConversations({
  group,
  ...props
}: Omit<ConversationNavigationProps, 'projects' | 'conversations'> & {
  group: ConversationGroup
  shortcutIndexes: ReadonlyMap<string, number>
}): React.JSX.Element {
  const containsActive = group.conversations.some(({ id }) => id === props.activeConversationId)
  const [disclosure, setDisclosure] = React.useState({
    open: group.isDefault || containsActive,
    activeConversationId: props.activeConversationId,
    isDefault: group.isDefault,
    selectionKey: props.selectionRequest?.key
  })
  const contentId = React.useId()
  const responding = group.conversations.some(({ id }) => props.respondingConversationIds.has(id))

  // Reset only the disclosure affected by external selection, before committing its rows.
  if (
    disclosure.activeConversationId !== props.activeConversationId ||
    disclosure.isDefault !== group.isDefault ||
    disclosure.selectionKey !== props.selectionRequest?.key
  ) {
    const requestedHere =
      disclosure.selectionKey !== props.selectionRequest?.key &&
      group.conversations.some(({ id }) => id === props.selectionRequest?.id)
    setDisclosure({
      open:
        disclosure.open ||
        (disclosure.activeConversationId !== props.activeConversationId && containsActive) ||
        requestedHere ||
        (!disclosure.isDefault && group.isDefault),
      activeConversationId: props.activeConversationId,
      isDefault: group.isDefault,
      selectionKey: props.selectionRequest?.key
    })
  }
  const { open } = disclosure

  return (
    <section aria-label={group.name}>
      <SidebarMenu>
        <SidebarMenuItem className="mx-1.5 my-px">
          <SidebarMenuButton
            aria-label={`Toggle ${group.name} conversations`}
            aria-controls={contentId}
            aria-expanded={open}
            className="h-[34px] rounded-lg px-[10px] text-[13px] font-normal text-text-secondary"
            onClick={() => setDisclosure((current) => ({ ...current, open: !current.open }))}
            title={group.path ?? group.name}
          >
            <ChevronRight aria-hidden="true" className={open ? 'size-3.5 rotate-90' : 'size-3.5'} />
            <FolderOpen aria-hidden="true" className="size-3.5" />
            <span className="min-w-0 flex-1 truncate">{group.name}</span>
            {!open && responding ? (
              <Spinner
                aria-label={`Generating response in ${group.name}`}
                className="size-3.5 shrink-0 text-text-tertiary"
              />
            ) : (
              <span className="text-[11px] text-text-tertiary">{group.conversations.length}</span>
            )}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <div id={contentId} hidden={!open} className="ml-3 mr-1">
        {group.conversations.length ? (
          <ConversationList {...props} conversations={group.conversations} />
        ) : (
          <p className="px-3 py-2 text-[11px] text-text-tertiary">No conversations yet.</p>
        )}
      </div>
    </section>
  )
}

function ConversationNavigation({
  conversations,
  projects,
  ...props
}: ConversationNavigationProps): React.JSX.Element {
  const { groups, recent } = React.useMemo(() => {
    const byProject = new Map<string, ConversationGroup>(
      projects.map((project) => [
        project.id,
        {
          id: project.id,
          name: project.name,
          path: project.rootPath,
          isDefault: project.isDefault,
          conversations: []
        }
      ])
    )
    const recent: Conversation[] = []
    const sorted = [...conversations].sort(
      (a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)
    )
    for (const conversation of sorted) {
      if (!conversation.projectId) {
        recent.push(conversation)
        continue
      }
      let group = byProject.get(conversation.projectId)
      if (!group) {
        const name =
          conversation.cwd?.split(/[\\/]/).filter(Boolean).at(-1) ?? conversation.projectId
        group = {
          id: conversation.projectId,
          name: `Unavailable workspace: ${name}`,
          path: conversation.cwd ?? null,
          isDefault: false,
          conversations: []
        }
        byProject.set(group.id, group)
      }
      group.conversations.push(conversation)
    }
    return {
      groups: [...byProject.values()].sort(
        (a, b) => latestActivity(b.conversations) - latestActivity(a.conversations)
      ),
      recent
    }
  }, [conversations, projects])
  const shortcutIndexes = React.useMemo(
    () => new Map(conversations.slice(0, 9).map(({ id }, index) => [id, index + 1])),
    [conversations]
  )

  return (
    <>
      {groups.length > 0 && (
        <SidebarGroupLabel className="px-3 text-[11px] font-normal text-text-tertiary">
          Projects
        </SidebarGroupLabel>
      )}
      {groups.map((group) => (
        <ProjectConversations
          key={group.id}
          {...props}
          group={group}
          shortcutIndexes={shortcutIndexes}
        />
      ))}
      {recent.length > 0 && (
        <>
          <SidebarGroupLabel className="mt-3 px-3 text-[11px] font-normal text-text-tertiary">
            Recent chats
          </SidebarGroupLabel>
          <ConversationList {...props} conversations={recent} shortcutIndexes={shortcutIndexes} />
        </>
      )}
      {!groups.length && !recent.length && (
        <p className="px-3 py-3 text-[11px] text-text-tertiary">
          No conversations yet. Start a new chat.
        </p>
      )}
    </>
  )
}

export { ConversationNavigation }
