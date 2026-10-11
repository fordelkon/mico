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
  Kbd,
  SidebarMenuButton,
  SidebarMenuItem,
  Spinner
} from '@mico/ui'
import type { ChatCompactionState } from '@renderer/hooks/chat/chat-session-instances'
import type { GlidingHighlightItemProps } from '@renderer/hooks/use-gliding-highlight'
import type { Conversation } from '@renderer/types/chat'
import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import * as React from 'react'

import './conversation-row.css'

const SPINNER_PHASE_LOCK_DELAY_MS = 500
const SPINNER_ANIMATION_DURATION_MS = 1000
const TITLE_SCROLL_SPEED_PX_PER_SECOND = 48

type ConversationRowProps = {
  conversation: Conversation
  compactionState?: ChatCompactionState
  onCompactConversation?: (id: string) => Promise<void>
  onCancelCompaction?: (id: string) => Promise<void>
  isResponding: boolean
  selected: boolean
  onDeleteConversation: (conversationId: string) => Promise<void>
  onRenameConversation: (conversationId: string, title: string) => Promise<void>
  onSelectConversation: (conversationId: string, options?: { focusComposer?: boolean }) => void
  shortcutNumber?: number
  glidingHighlightItemProps?: GlidingHighlightItemProps<HTMLLIElement>
}

function ConversationRowStatus({
  label = 'Generating response',
  isCompacting = false
}: {
  label?: string
  isCompacting?: boolean
}): React.JSX.Element {
  const [animationDelay, setAnimationDelay] = React.useState<number | null>(null)

  React.useEffect(() => {
    const timeout = window.setTimeout(
      () => setAnimationDelay(-(Date.now() % SPINNER_ANIMATION_DURATION_MS)),
      SPINNER_PHASE_LOCK_DELAY_MS
    )
    return () => window.clearTimeout(timeout)
  }, [])

  return (
    <Spinner
      aria-label={label}
      aria-busy={isCompacting || undefined}
      role={isCompacting ? undefined : 'status'}
      className="conversation-row__status size-3.5 text-text-tertiary"
      style={animationDelay === null ? undefined : { animationDelay: `${animationDelay}ms` }}
    />
  )
}

function ConversationRowComponent({
  conversation,
  compactionState,
  onCompactConversation,
  onCancelCompaction,
  isResponding,
  selected,
  onDeleteConversation,
  onRenameConversation,
  onSelectConversation,
  shortcutNumber,
  glidingHighlightItemProps
}: ConversationRowProps): React.JSX.Element {
  const isCompacting = compactionState?.status === 'pending'
  const compactionError =
    compactionState?.status === 'failed'
      ? compactionState.message
      : compactionState?.status === 'pending'
        ? compactionState.error
        : undefined
  const [editing, setEditing] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = React.useState(false)
  const [draft, setDraft] = React.useState(conversation.title)
  const [savingTitle, setSavingTitle] = React.useState(false)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const errorId = React.useId()
  const renamePendingRef = React.useRef(false)
  const deletePendingRef = React.useRef(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const titleViewportRef = React.useRef<HTMLSpanElement>(null)
  const cancelledRef = React.useRef(false)
  const [titleOverflow, setTitleOverflow] = React.useState(0)

  React.useLayoutEffect(() => {
    const titleViewport = titleViewportRef.current
    if (!titleViewport) return

    const measureTitleOverflow = (): void => {
      const overflow = Math.max(0, titleViewport.scrollWidth - titleViewport.clientWidth)
      setTitleOverflow((currentOverflow) =>
        currentOverflow === overflow ? currentOverflow : overflow
      )
    }

    measureTitleOverflow()

    const ResizeObserverClass = window.ResizeObserver
    if (!ResizeObserverClass) return

    const resizeObserver = new ResizeObserverClass(measureTitleOverflow)
    resizeObserver.observe(titleViewport)
    return () => resizeObserver.disconnect()
  }, [conversation.title, editing])

  // Focus after edit mode renders its input; the row itself has no editable target.
  React.useEffect(() => {
    if (!editing) return

    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const beginRename = (): void => {
    cancelledRef.current = false
    setActionError(null)
    setDraft(conversation.title)
    setEditing(true)
  }

  const beginRenameFromContextMenu = (): void => {
    // Let the menu release focus before the editing input claims it.
    window.requestAnimationFrame(beginRename)
  }

  const handleDoubleClick = (): void => {
    // Keep focus on the title being edited instead of moving it to the composer.
    onSelectConversation(conversation.id, { focusComposer: false })
    beginRename()
  }

  const commitRename = async (): Promise<void> => {
    if (cancelledRef.current || renamePendingRef.current) return
    const title = draft.trim()
    if (!title || title === conversation.title) {
      setActionError(null)
      setEditing(false)
      return
    }
    renamePendingRef.current = true
    setSavingTitle(true)
    setActionError(null)
    try {
      await onRenameConversation(conversation.id, title)
      setEditing(false)
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'Could not rename this conversation. Try renaming it again.'
      )
      inputRef.current?.focus()
    } finally {
      renamePendingRef.current = false
      setSavingTitle(false)
    }
  }

  const deleteConversation = async (): Promise<void> => {
    if (deletePendingRef.current) return
    deletePendingRef.current = true
    try {
      await onDeleteConversation(conversation.id)
    } catch (error) {
      setDeleting(false)
      setActionError(
        error instanceof Error
          ? error.message
          : 'Could not delete this conversation. Try deleting it again.'
      )
    } finally {
      deletePendingRef.current = false
    }
  }

  const confirmDelete = (): void => {
    if (deleting || deletePendingRef.current || isCompacting) return

    setDeleteConfirmationOpen(false)
    setActionError(null)
    setDeleting(true)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Do not delay deletion behind an animation the user asked to suppress.
      void deleteConversation()
    }
  }

  const handleDeleteAnimationEnd = (event: React.AnimationEvent<HTMLLIElement>): void => {
    if (
      !deleting ||
      event.currentTarget !== event.target ||
      (event.animationName && event.animationName !== 'conversation-row-delete')
    ) {
      return
    }

    void deleteConversation()
  }

  const titleStyle: React.CSSProperties &
    Record<'--conversation-row-title-offset' | '--conversation-row-title-duration', string> = {
    '--conversation-row-title-offset': `${titleOverflow}px`,
    '--conversation-row-title-duration': `${(titleOverflow / TITLE_SCROLL_SPEED_PX_PER_SECOND) * 1000}ms`
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={editing || deleting}>
        <SidebarMenuItem
          aria-busy={deleting || savingTitle || undefined}
          className="conversation-row mx-1.5 my-px"
          data-deleting={deleting || undefined}
          data-responding={isResponding || undefined}
          {...glidingHighlightItemProps}
          onAnimationEnd={handleDeleteAnimationEnd}
        >
          {editing ? (
            <div className="px-1.5 py-px">
              <Input
                className="border-border-subtle bg-sidebar-row-hover text-[13px]"
                ref={inputRef}
                aria-label="Conversation title"
                aria-describedby={actionError ? errorId : undefined}
                aria-invalid={actionError ? true : undefined}
                readOnly={savingTitle}
                value={draft}
                onBlur={() => void commitRename()}
                onChange={(event) => setDraft(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  event.stopPropagation()

                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void commitRename()
                  }

                  if (event.key === 'Escape' && !renamePendingRef.current) {
                    event.preventDefault()
                    cancelledRef.current = true
                    setDraft(conversation.title)
                    setActionError(null)
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
              data-title-overflowing={titleOverflow > 0 || undefined}
              disabled={deleting}
              isActive={selected}
              onClick={() => onSelectConversation(conversation.id)}
              onDoubleClick={handleDoubleClick}
              style={titleStyle}
              tooltip={conversation.title}
            >
              <span className="conversation-row__title-viewport" ref={titleViewportRef}>
                <span className="conversation-row__title">{conversation.title}</span>
              </span>
              {shortcutNumber !== undefined && (
                <Kbd className="conversation-row__shortcut">⌘ {shortcutNumber}</Kbd>
              )}
            </SidebarMenuButton>
          )}
          {!editing && !deleting && shortcutNumber === undefined && (
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
                <DropdownMenuItem
                  disabled={isResponding || isCompacting || !onCompactConversation}
                  onSelect={() => void onCompactConversation?.(conversation.id)}
                >
                  Compact context
                </DropdownMenuItem>
                {isCompacting && (
                  <DropdownMenuItem onSelect={() => void onCancelCompaction?.(conversation.id)}>
                    Cancel summary
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={isCompacting}
                  variant="destructive"
                  onSelect={() => setDeleteConfirmationOpen(true)}
                >
                  <Trash2Icon aria-hidden="true" />
                  Delete
                </DropdownMenuItem>
              </IconMenuButton>
            </div>
          )}
          {!editing && !deleting && shortcutNumber === undefined && isResponding && (
            <ConversationRowStatus />
          )}
          {isCompacting && <ConversationRowStatus label="Summarizing conversation" isCompacting />}
          {compactionState?.status === 'accepted' && (
            <p className="px-2.5 py-1 text-xs text-text-tertiary" role="status">
              Context compacted.
            </p>
          )}
          {compactionError && (
            <p className="px-2.5 py-1 text-xs text-destructive" role="alert">
              {compactionError}
            </p>
          )}
          {actionError && (
            <p className="px-2.5 py-1 text-xs text-destructive" id={errorId} role="alert">
              {actionError}
            </p>
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
        <ContextMenuItem
          disabled={isResponding || isCompacting || !onCompactConversation}
          onSelect={() => void onCompactConversation?.(conversation.id)}
        >
          Compact context
        </ContextMenuItem>
        {isCompacting && (
          <ContextMenuItem onSelect={() => void onCancelCompaction?.(conversation.id)}>
            Cancel summary
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={isCompacting}
          variant="destructive"
          onSelect={() => setDeleteConfirmationOpen(true)}
        >
          <Trash2Icon aria-hidden="true" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

const ConversationRow = React.memo(ConversationRowComponent)

export { ConversationRow }
