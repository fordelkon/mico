import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  IconMenuButton,
  Input,
  SidebarMenuButton,
  SidebarMenuItem
} from '@mico/ui'
import type { Conversation } from '@renderer/lib/ai/chat-types'
import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import * as React from 'react'

import './conversation-row.css'

type ConversationRowProps = {
  conversation: Conversation
  selected: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onDelete: () => void
}

function ConversationRow({
  conversation,
  selected,
  onSelect,
  onRename,
  onDelete
}: ConversationRowProps): React.JSX.Element {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(conversation.title)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const cancelledRef = React.useRef(false)

  React.useEffect(() => {
    if (!editing) return

    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const beginRename = (): void => {
    cancelledRef.current = false
    setDraft(conversation.title)
    setEditing(true)
  }

  const commitRename = (): void => {
    if (!cancelledRef.current) onRename(draft.trim())
    setEditing(false)
  }

  return (
    <SidebarMenuItem className="conversation-row mx-1.5 my-px">
      {editing ? (
        <div className="px-1.5 py-px">
          <Input
            className="border-border-subtle bg-sidebar-row-hover text-[13px]"
            ref={inputRef}
            aria-label="Conversation title"
            value={draft}
            onBlur={commitRename}
            onChange={(event) => setDraft(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation()

              if (event.key === 'Enter') {
                event.preventDefault()
                commitRename()
              }

              if (event.key === 'Escape') {
                event.preventDefault()
                cancelledRef.current = true
                setDraft(conversation.title)
                setEditing(false)
              }
            }}
            onPointerDown={(event) => event.stopPropagation()}
          />
        </div>
      ) : (
        <SidebarMenuButton
          aria-pressed={selected}
          className="h-[34px] rounded-lg px-[10px] pr-[34px] text-[13px] font-normal text-text-secondary transition-colors hover:bg-sidebar-row-hover hover:text-text-secondary data-[active=true]:bg-sidebar-row-active data-[active=true]:text-text-secondary"
          isActive={selected}
          onClick={onSelect}
          tooltip={conversation.title}
        >
          <span>{conversation.title}</span>
        </SidebarMenuButton>
      )}
      {!editing && (
        <div
          className="conversation-row__actions"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <IconMenuButton
            className="text-text-tertiary hover:bg-[color:color-mix(in_oklab,var(--sidebar-row-active)_78%,var(--sidebar))] hover:text-text-secondary aria-expanded:bg-[color:color-mix(in_oklab,var(--sidebar-row-active)_78%,var(--sidebar))] aria-expanded:text-text-secondary"
            icon={<MoreHorizontalIcon aria-hidden="true" />}
            label="More actions"
            size="icon-xs"
          >
            <DropdownMenuItem onSelect={beginRename}>
              <PencilIcon aria-hidden="true" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2Icon aria-hidden="true" />
              Delete
            </DropdownMenuItem>
          </IconMenuButton>
        </div>
      )}
    </SidebarMenuItem>
  )
}

export { ConversationRow }
