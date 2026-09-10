import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
  IconMenuButton,
  Input,
  SidebarMenuButton,
  SidebarMenuItem,
  Spinner
} from '@mico/ui'
import type { Conversation } from '@renderer/types/chat'
import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import * as React from 'react'

import './conversation-row.css'

type ConversationRowProps = {
  conversation: Conversation
  isResponding: boolean
  selected: boolean
  onSelect: (options?: { focusComposer?: boolean }) => void
  onRename: (title: string) => void
  onDelete: () => void
}

function ConversationRow({
  conversation,
  isResponding,
  selected,
  onSelect,
  onRename,
  onDelete
}: ConversationRowProps): React.JSX.Element {
  const [editing, setEditing] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = React.useState(false)
  const [draft, setDraft] = React.useState(conversation.title)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const cancelledRef = React.useRef(false)

  // Focus after edit mode renders its input; the row itself has no editable target.
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

  const beginRenameFromContextMenu = (): void => {
    // Let the menu release focus before the editing input claims it.
    window.requestAnimationFrame(beginRename)
  }

  const handleDoubleClick = (): void => {
    // Keep focus on the title being edited instead of moving it to the composer.
    onSelect({ focusComposer: false })
    beginRename()
  }

  const commitRename = (): void => {
    if (!cancelledRef.current) onRename(draft.trim())
    setEditing(false)
  }

  const confirmDelete = (): void => {
    if (deleting) return

    setDeleteConfirmationOpen(false)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Do not delay deletion behind an animation the user asked to suppress.
      onDelete()
      return
    }

    setDeleting(true)
  }

  const handleDeleteAnimationEnd = (event: React.AnimationEvent<HTMLLIElement>): void => {
    if (
      !deleting ||
      event.currentTarget !== event.target ||
      (event.animationName && event.animationName !== 'conversation-row-delete')
    ) {
      return
    }

    onDelete()
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={editing || deleting}>
        <SidebarMenuItem
          aria-busy={deleting || undefined}
          className="conversation-row mx-1.5 my-px"
          data-deleting={deleting || undefined}
          data-responding={isResponding || undefined}
          onAnimationEnd={handleDeleteAnimationEnd}
        >
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
              disabled={deleting}
              isActive={selected}
              onClick={() => onSelect()}
              onDoubleClick={handleDoubleClick}
              tooltip={conversation.title}
            >
              <span>{conversation.title}</span>
            </SidebarMenuButton>
          )}
          {!editing && !deleting && (
            <div
              className="conversation-row__actions"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <IconMenuButton
                className="text-text-tertiary hover:bg-sidebar-row-action hover:text-text-secondary aria-expanded:bg-sidebar-row-action aria-expanded:text-text-secondary"
                icon={<MoreHorizontalIcon aria-hidden="true" />}
                label="More actions"
                size="icon-xs"
              >
                <DropdownMenuItem onSelect={beginRename}>
                  <PencilIcon aria-hidden="true" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setDeleteConfirmationOpen(true)}
                >
                  <Trash2Icon aria-hidden="true" />
                  Delete
                </DropdownMenuItem>
              </IconMenuButton>
            </div>
          )}
          {!editing && !deleting && isResponding && (
            <Spinner
              aria-label="Generating response"
              className="conversation-row__status size-3.5 text-text-tertiary"
            />
          )}
          <AlertDialog open={deleteConfirmationOpen} onOpenChange={setDeleteConfirmationOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes &ldquo;{conversation.title}&rdquo; and its messages.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={confirmDelete}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </SidebarMenuItem>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={beginRenameFromContextMenu}>
          <PencilIcon aria-hidden="true" />
          Rename
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => setDeleteConfirmationOpen(true)}>
          <Trash2Icon aria-hidden="true" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export { ConversationRow }
