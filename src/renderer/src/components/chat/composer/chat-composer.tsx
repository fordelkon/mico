import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  IconSwap,
  IconTooltipButton,
  Spinner,
  Textarea
} from '@mico/ui'
import type { PermissionMode } from '@shared/ai/permissions'
import type { ChatSkillInvocationPart } from '@shared/ai/skills'

import type {
  ChatDocumentPart,
  ModelReasoningCapabilities,
  ThinkingSelection
} from '@shared/data/schemas/chat'
import type { WorkspaceProject } from '@shared/data/schemas/workspace'
import { ArrowUpIcon, ShieldCheckIcon, ShieldIcon, SquareIcon } from 'lucide-react'
import * as React from 'react'
import { ChatModelSelector } from './chat-model-selector'
import { ComposerAttachmentList, ComposerAttachments } from './composer-attachments'
import { ComposerTokenHighlight } from './composer-token-highlight'
import { deleteTextareaRange, insertTextareaText } from './composer-edit-commands'
import { arrowTokenJump, backspaceDeletion, wordBackspaceDeletion } from './composer-editing'
import { projectComposerDraft } from './draft/composer-draft-model'
import { composerDraftKey, useChatComposerDraft } from './draft/composer-drafts'
import { ProjectSelector } from './project-selector'
import { ThinkingSelector } from './thinking-selector'
import { useComposerModelSelection } from './use-composer-model-selection'
import { useComposerSkills } from './use-composer-skills'
import './chat-composer.css'

type ChatComposerMode = 'disabled' | 'send' | 'stop'

type ChatComposerProps = {
  approval?: React.ReactNode
  permissionMode?: PermissionMode
  onPermissionModeChange?: (mode: PermissionMode) => void
  canAddProject?: boolean
  focusKey: number
  mode: ChatComposerMode
  onModelSelected: () => Promise<void>
  onAddProject?: () => Promise<void>
  onProjectSelected?: (project: WorkspaceProject) => void
  onProjectsRefresh?: () => Promise<void>
  projectId?: string | null
  projectLabel?: string | null
  projectPath?: string | null
  projects?: WorkspaceProject[]
  selectedModelEntryId?: string | null
  selectSessionModel?: (modelEntryId: string) => Promise<void>
  /**
   * Conversation identity of the active draft. `null` means a chat that does
   * not exist yet; its draft survives project changes and is cleared by the
   * submitted identity when the first message goes out.
   */
  draftConversationId?: string | null
  onSend: (content: {
    text: string
    documents: ChatDocumentPart[]
    skillInvocation?: ChatSkillInvocationPart['data']
  }) => Promise<boolean>
  // Dispatches the built-in /compact command for the active conversation.
  // Its absence hides the command; availability is gated by the composer mode.
  onCompact?: () => void
  onStop: () => void
  reasoningCapabilities: ModelReasoningCapabilities | null
  thinkingEffort: ThinkingSelection
  onThinkingEffortChange: (selection: ThinkingSelection) => void
}

// Typing shortcuts apply only on non-interactive background targets. The same
// boundary lets blank surface clicks focus the input without stealing controls.
// Interactive roles are enumerated instead of matching every [role]/[tabindex]:
// focusable trace/log containers must keep the type-to-focus behavior.
const interactiveTargetSelector = [
  'input',
  'textarea',
  'select',
  'button',
  'a',
  'summary',
  'details',
  'label',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="tab"]',
  '[role="slider"]',
  '[role^="menu"]'
].join(', ')

function ChatComposer({
  approval,
  permissionMode = 'default',
  onPermissionModeChange,
  canAddProject = false,
  focusKey,
  mode,
  onModelSelected,
  onAddProject,
  onProjectSelected,
  onProjectsRefresh,
  projectId,
  projectLabel,
  projectPath,
  projects = [],
  selectedModelEntryId,
  selectSessionModel,
  draftConversationId = null,
  onSend,
  onCompact,
  onStop,
  reasoningCapabilities,
  thinkingEffort,
  onThinkingEffortChange
}: ChatComposerProps): React.JSX.Element {
  const { currentModelId, hasSelectedModel, library, selectionError, selectModel } =
    useComposerModelSelection({ onModelSelected, selectedModelEntryId, selectSessionModel })
  // Drafts live in the renderer-owned store, so switching conversations keeps
  // each draft separate and leaving for Settings keeps the draft alive.
  const draftKey = composerDraftKey(draftConversationId)
  const [draft, draftActions] = useChatComposerDraft(draftKey)
  // The caret position at the latest edit; the menu opens only while the user
  // is still editing the leading token.
  const [selection, setSelection] = React.useState({ key: draftKey, caret: draft.text.length })
  const caret = selection.key === draftKey ? selection.caret : draft.text.length
  const skills = useComposerSkills(projectId, draft.text, {
    offerCompactCommand: onCompact !== undefined,
    caret
  })
  // Commands list before skills; the first skill entry starts the skills group.
  const firstSkillIndex = skills.matches.findIndex((item) => item.kind === 'skill')
  const commandCount = firstSkillIndex === -1 ? skills.matches.length : firstSkillIndex
  const projection = projectComposerDraft(draft, skills.knownSkillNames)
  const canSubmitDraft = projection.isCompactCommand || (hasSelectedModel && projection.hasContent)
  const skillMenuId = React.useId()
  const capabilityHintId = React.useId()
  const activeSkillRef = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (skills.isOpen) activeSkillRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [skills.isOpen, skills.selectedIndex, draft.text])
  const [isFocused, setIsFocused] = React.useState(false)
  const [permissionMenuOpen, setPermissionMenuOpen] = React.useState(false)
  const skillsMenuRef = React.useRef<HTMLElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  // The mounted textarea element, so effects that render before the textarea
  // sibling (the highlight mirror) can depend on the element itself instead of
  // reading a ref that is still null during their first layout effect run.
  const [textarea, setTextarea] = React.useState<HTMLTextAreaElement | null>(null)
  const attachTextarea = React.useCallback((node: HTMLTextAreaElement | null) => {
    textareaRef.current = node
    setTextarea(node)
  }, [])
  const compositionRef = React.useRef(false)
  // IME composition hides the highlight mirror so the native glyphs and
  // underline stay visible; the keydown guard keeps awaiting confirmation.
  const [isComposing, setIsComposing] = React.useState(false)
  const mountedRef = React.useRef(false)
  const previousFocusKeyRef = React.useRef(focusKey)
  const previousModeRef = React.useRef(mode)
  const isDisabled = mode === 'disabled' || draft.isSending
  const configurationDisabled = mode !== 'send' || draft.isSending
  const hasSkills = skills.knownSkillNames.size > 0
  const hasCommands = onCompact !== undefined
  const capabilityHint =
    hasCommands && hasSkills
      ? 'Use / for commands, $ for skills.'
      : hasCommands
        ? 'Use / for commands.'
        : hasSkills
          ? 'Use $ for skills.'
          : ''

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target instanceof HTMLElement ? event.target : document.activeElement
      const isInteractiveTarget =
        target instanceof HTMLElement &&
        (target.isContentEditable || Boolean(target.closest(interactiveTargetSelector)))

      if (
        mode !== 'send' ||
        draft.isSending ||
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.key.length !== 1 ||
        isInteractiveTarget
      )
        return

      textareaRef.current?.focus()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [draft.isSending, mode])

  // Restore typing readiness after a conversation becomes available for input.
  React.useEffect(() => {
    const isInitialMount = !mountedRef.current
    const focusKeyChanged = previousFocusKeyRef.current !== focusKey
    const becameSendable = previousModeRef.current !== 'send' && mode === 'send'
    const shouldFocusOnMount = isInitialMount && focusKey > 0
    mountedRef.current = true
    previousFocusKeyRef.current = focusKey
    previousModeRef.current = mode

    if ((focusKeyChanged || becameSendable || shouldFocusOnMount) && mode === 'send') {
      textareaRef.current?.focus()
    }
  }, [focusKey, mode])

  React.useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [draft.text, draftKey])

  const submit = (): void => {
    void draftActions.submit({
      canSend: mode === 'send',
      hasSelectedModel,
      onSend,
      onCompact,
      resolveInvocation: skills.resolveInvocation
    })
  }

  const selectCompletion = (item: (typeof skills.matches)[number]): void => {
    const textarea = textareaRef.current
    if (!textarea) return
    // A single browser edit transaction — not a setState write — keeps the
    // input event flow and native undo/redo identical to typing.
    const completion = skills.applyCompletion(item)
    textarea.focus()
    textarea.setSelectionRange(0, completion.replacedEnd)
    insertTextareaText(completion.text)
    textarea.setSelectionRange(completion.caret, completion.caret)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    const nativeEvent = event.nativeEvent
    // IME confirmation arrives as a composition event (isComposing, keyCode
    // 229, or key "Process"); selection and sending must wait for the composed
    // text instead of treating the confirming keystroke as a command.
    if (
      compositionRef.current ||
      nativeEvent.isComposing ||
      nativeEvent.keyCode === 229 ||
      nativeEvent.key === 'Process'
    )
      return
    // Modified keys retain native editing even while completions are open.
    const isPlainKey = !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
    if (skills.isOpen && mode === 'send' && !isDisabled && isPlainKey) {
      if (event.key === 'Escape') {
        event.preventDefault()
        skills.dismiss()
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        skills.moveSelection(event.key === 'ArrowDown' ? 1 : -1)
        return
      }
      if (event.key === 'Home' && skills.matches.length) {
        event.preventDefault()
        skills.selectIndex(0)
        return
      }
      if (event.key === 'End' && skills.matches.length) {
        event.preventDefault()
        skills.selectIndex(skills.matches.length - 1)
        return
      }
      if (event.key === 'Enter') {
        // An unmatched leading token is still being edited; Enter must not
        // accidentally submit it as a half-written command.
        event.preventDefault()
        if (skills.matches.length) selectCompletion(skills.matches[skills.selectedIndex])
        return
      }
      if (event.key === 'Tab' && skills.matches.length) {
        event.preventDefault()
        selectCompletion(skills.matches[skills.selectedIndex])
        return
      }
    }
    // Atomic editing of the leading invocation token. Collapsed carets move or
    // delete the whole token through one native edit transaction (native
    // undo/redo included); selections, Shift, IME, and carets outside the
    // token keep the browser's own behavior.
    const textarea = textareaRef.current
    const caretCollapsed = Boolean(textarea && textarea.selectionStart === textarea.selectionEnd)
    const keyCaret = textarea?.selectionStart ?? 0
    if (event.key === 'Backspace' && caretCollapsed && !event.altKey && !event.shiftKey) {
      const deletion =
        event.ctrlKey || event.metaKey
          ? wordBackspaceDeletion(draft.text, projection.tokens, keyCaret)
          : isPlainKey
            ? backspaceDeletion(projection.tokens, keyCaret)
            : null
      if (deletion && textarea) {
        event.preventDefault()
        deleteTextareaRange(textarea, deletion.start, deletion.end)
        return
      }
    }
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && isPlainKey && caretCollapsed) {
      const jump = arrowTokenJump(
        projection.tokens,
        keyCaret,
        event.key === 'ArrowLeft' ? 'left' : 'right'
      )
      if (jump !== null && textarea) {
        event.preventDefault()
        textarea.setSelectionRange(jump, jump)
        return
      }
    }
    // Enter submits only when submission is actually possible; otherwise the
    // browser's default newline applies. Stop-mode drafts stay editable, and
    // modified Enter keystrokes keep their platform behavior.
    if (
      event.key === 'Enter' &&
      isPlainKey &&
      mode === 'send' &&
      !draft.isSending &&
      canSubmitDraft
    ) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form
      className="chat-composer shrink-0 px-4 pb-5 pt-3 sm:px-6"
      onKeyDownCapture={(event) => {
        // Native buttons also activate on Enter. Apply the same plain-Enter
        // contract to footer controls and their portalled menus.
        if (
          event.key === 'Enter' &&
          event.target !== textareaRef.current &&
          (event.shiftKey ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.nativeEvent.isComposing)
        ) {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="mx-auto w-full max-w-[50rem]">
        {approval}
        {canAddProject ? (
          // The workspace control lives above the input surface as its own
          // row; existing conversations keep theirs in the conversation header.
          <div className="mb-2 flex min-w-0 items-center">
            <ProjectSelector
              appearance="pill"
              canAddProject={canAddProject}
              disabled={configurationDisabled}
              onAddProject={onAddProject}
              onProjectSelected={onProjectSelected}
              onProjectsRefresh={onProjectsRefresh}
              projectId={projectId}
              projectLabel={projectLabel}
              projectPath={projectPath}
              projects={projects}
            />
          </div>
        ) : null}
        <div
          data-input-focused={isFocused ? 'true' : undefined}
          className="chat-composer__surface relative flex w-full flex-col gap-2 rounded-[var(--radius-composer)] border bg-chat-composer p-3 transition-colors"
          onClick={(event) => {
            const target = event.target
            if (
              target instanceof Element &&
              !target.closest(interactiveTargetSelector) &&
              !window.getSelection()?.toString()
            )
              textareaRef.current?.focus()
          }}
        >
          {skills.isOpen && !isDisabled && mode === 'send' ? (
            <section
              ref={skillsMenuRef}
              aria-label="Commands and skills"
              className="absolute bottom-full left-0 z-20 mb-2 max-h-72 w-full overflow-y-auto rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg"
            >
              {skills.status === 'loading' ? (
                <p role="status" className="px-2 py-2 text-sm text-muted-foreground">
                  Loading skills…
                </p>
              ) : null}
              {skills.error ? (
                <div className="px-2 py-2 text-sm">
                  <p role="alert">{skills.error}</p>
                  <button
                    type="button"
                    className="mt-2 rounded-md px-2 py-1 text-primary hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                    onClick={skills.retry}
                  >
                    Retry skills
                  </button>
                </div>
              ) : null}
              <div id={skillMenuId} role="listbox" aria-label="Commands and skills">
                {commandCount > 0 && (
                  <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Commands</p>
                )}
                {skills.matches.map((item, index) => (
                  <React.Fragment key={item.id}>
                    {index === commandCount && (
                      <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Skills</p>
                    )}
                    <button
                      ref={index === skills.selectedIndex ? activeSkillRef : undefined}
                      id={`${skillMenuId}-${index}`}
                      type="button"
                      role="option"
                      aria-selected={index === skills.selectedIndex}
                      tabIndex={-1}
                      className="flex min-w-0 w-full flex-col gap-1 rounded-lg px-2 py-2 text-left aria-selected:bg-accent aria-selected:text-accent-foreground"
                      onMouseEnter={() => skills.selectIndex(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectCompletion(item)}
                    >
                      {item.kind === 'command' ? (
                        <span className="flex w-full min-w-0 items-baseline gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            /{item.name}
                          </span>
                          <span className="truncate text-sm font-medium">{item.label}</span>
                        </span>
                      ) : (
                        <span className="w-full truncate text-sm font-medium">{item.name}</span>
                      )}
                      <span
                        className="w-full truncate text-xs text-muted-foreground"
                        title={item.description}
                      >
                        {item.kind === 'command'
                          ? item.description
                          : item.description.replace(/\s+/g, ' ').trim()}
                      </span>
                    </button>
                  </React.Fragment>
                ))}
              </div>
              {skills.status === 'ready' && !skills.matches.length ? (
                skills.queryMode === 'dollar' ? (
                  <>
                    <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Skills</p>
                    <p className="px-2 py-2 text-sm text-muted-foreground">
                      {projectId ? 'No matching skills.' : 'Choose a workspace to use skills.'}
                    </p>
                  </>
                ) : (
                  <p className="px-2 py-2 text-sm text-muted-foreground">No matching commands.</p>
                )
              ) : null}
              {skills.diagnostics.length ? (
                <div className="mt-1 border-t border-border px-2 pt-2 text-xs text-muted-foreground">
                  <details>
                    <summary className="cursor-pointer rounded-sm py-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                      {skills.diagnostics.length} skill discovery{' '}
                      {skills.diagnostics.length === 1 ? 'warning' : 'warnings'}
                    </summary>
                    <ul
                      aria-label="Skill discovery warnings"
                      className="mt-2 max-h-32 space-y-3 overflow-y-auto overscroll-contain break-words pr-2 [overflow-wrap:anywhere]"
                    >
                      {skills.diagnostics.map(({ path, message, source }, index) => (
                        <li key={`${source}:${path}:${index}`}>
                          <p className="font-medium text-popover-foreground">{path}</p>
                          <p>{message}</p>
                        </li>
                      ))}
                    </ul>
                  </details>
                  <button
                    type="button"
                    className="mt-1 rounded-md px-2 py-1 text-primary hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                    onClick={skills.retry}
                  >
                    Retry skills
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}
          <ComposerAttachmentList
            disabled={configurationDisabled}
            documents={draft.documents}
            onDocumentsChange={draftActions.setDocuments}
          />
          {projection.canRepairPaste ? (
            <div className="flex items-center gap-2 px-2 text-xs">
              <span className="text-destructive" role="alert">
                {projection.pasteIssue}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 px-2 text-xs"
                onClick={() => draftActions.repair(textareaRef.current)}
              >
                Restore pasted text
              </Button>
            </div>
          ) : null}
          <div className="relative">
            <ComposerTokenHighlight
              draft={draft.text}
              hidden={isComposing}
              tokens={projection.tokens}
              textarea={textarea}
            />
            {/* The hint is a static overlay instead of the native placeholder:
                Chromium lets a double-click on an empty textarea select the
                placeholder text. It sits inert and unselectable, mirroring the
                native placeholder's visibility (empty draft only). */}
            {capabilityHint && !draft.text ? (
              <span
                aria-hidden="true"
                id={capabilityHintId}
                className="chat-composer__hint pointer-events-none absolute left-0 top-0 z-0 select-none px-2 py-2 text-[15px] leading-6 text-muted-foreground/80"
              >
                {capabilityHint}
              </span>
            ) : null}
            <Textarea
              className="chat-composer__input relative min-h-10 max-h-40 resize-none border-0 px-2 py-2 text-[15px] leading-6 shadow-none focus-visible:border-transparent focus-visible:ring-0 disabled:bg-transparent dark:bg-transparent"
              ref={attachTextarea}
              aria-label="Message"
              // The visual hint is aria-hidden, so screen readers reach the
              // same text through description instead (the native placeholder
              // it replaces was announced).
              aria-describedby={capabilityHint && !draft.text ? capabilityHintId : undefined}
              data-composing={isComposing ? 'true' : undefined}
              aria-controls={skills.isOpen ? skillMenuId : undefined}
              aria-autocomplete="list"
              aria-activedescendant={
                skills.isOpen && skills.matches.length
                  ? `${skillMenuId}-${skills.selectedIndex}`
                  : undefined
              }
              disabled={isDisabled}
              onBlur={(event) => {
                setIsFocused(false)
                // Leaving the composer dismisses the menu, including focus
                // moving to footer controls whose own popovers must not stack
                // on top of it. Focus staying inside this menu (for example
                // Retry skills) keeps it interactive.
                const nextTarget = event.relatedTarget
                if (!(nextTarget instanceof Node && skillsMenuRef.current?.contains(nextTarget)))
                  skills.dismiss()
              }}
              onChange={(event) => {
                skills.resetDismissal()
                const text = event.target.value
                setSelection({
                  key: draftKey,
                  caret: event.target.selectionStart ?? text.length
                })
                // Observation keeps native undo/redo with the browser; the
                // editor re-locates, retires, or flags tokens from this event.
                draftActions.observe(text)
              }}
              onCompositionStart={() => {
                compositionRef.current = true
                setIsComposing(true)
              }}
              onCompositionEnd={() => {
                compositionRef.current = false
                setIsComposing(false)
              }}
              onSelect={(event) => {
                setSelection({
                  key: draftKey,
                  caret: event.currentTarget.selectionStart ?? event.currentTarget.value.length
                })
              }}
              onFocus={() => setIsFocused(true)}
              onKeyDown={handleKeyDown}
              onCopy={draftActions.copy}
              onCut={draftActions.cut}
              onPaste={draftActions.paste}
              value={draft.text}
            />
          </div>
          {selectionError ? (
            <p className="px-2 text-xs text-destructive" role="alert">
              {selectionError}
            </p>
          ) : null}
          {draft.sendError ? (
            <p className="px-2 text-xs text-destructive" role="alert">
              {draft.sendError}
            </p>
          ) : null}
          <div
            className="chat-composer-footer flex min-w-0 flex-nowrap items-center gap-1.5"
            onFocusCapture={skills.dismiss}
            onPointerDownCapture={skills.dismiss}
          >
            <ComposerAttachments
              key={draftKey}
              disabled={configurationDisabled}
              documents={draft.documents}
              onDocumentsChange={draftActions.setDocuments}
            />
            <div className="chat-composer-footer__generation flex min-w-0 items-center gap-1.5">
              <ChatModelSelector
                disabled={configurationDisabled}
                library={library}
                onSelect={selectModel}
                selectedModelId={currentModelId}
              />
              {reasoningCapabilities ? (
                <ThinkingSelector
                  disabled={configurationDisabled}
                  onValueChange={onThinkingEffortChange}
                  reasoningCapabilities={reasoningCapabilities}
                  value={thinkingEffort}
                />
              ) : null}
            </div>
            {onPermissionModeChange && projectPath && (
              <DropdownMenu open={permissionMenuOpen} onOpenChange={setPermissionMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <IconTooltipButton
                    className="size-7 shrink-0"
                    disabled={configurationDisabled}
                    icon={
                      permissionMode === 'acceptEdits' ? (
                        <ShieldCheckIcon aria-hidden="true" />
                      ) : (
                        <ShieldIcon aria-hidden="true" />
                      )
                    }
                    label={`Tool permissions: ${
                      permissionMode === 'acceptEdits' ? 'Accept edits' : 'Manual'
                    }`}
                    // The menu opens above the trigger, so the tooltip reads
                    // below it and stays hidden while the menu is open.
                    tooltip={`Permissions: ${
                      permissionMode === 'acceptEdits' ? 'Accept edits' : 'Manual'
                    }`}
                    tooltipDisabled={permissionMenuOpen}
                    tooltipSide="bottom"
                    tooltipAlign="start"
                    size="icon-sm"
                    type="button"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" sideOffset={8} className="min-w-40">
                  <DropdownMenuRadioGroup
                    value={permissionMode}
                    onValueChange={(value) => {
                      if (
                        !configurationDisabled &&
                        (value === 'default' || value === 'acceptEdits')
                      )
                        onPermissionModeChange(value)
                    }}
                  >
                    <DropdownMenuRadioItem disabled={configurationDisabled} value="default">
                      Manual
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem disabled={configurationDisabled} value="acceptEdits">
                      Accept edits
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <IconTooltipButton
              className="ml-auto size-9 shrink-0"
              disabled={
                draft.isSending || mode === 'disabled' || (mode === 'send' && !canSubmitDraft)
              }
              icon={
                draft.isSending ? (
                  <Spinner aria-hidden="true" />
                ) : (
                  <IconSwap
                    from={<ArrowUpIcon aria-hidden="true" />}
                    state={mode === 'stop' ? 'to' : 'from'}
                    to={<SquareIcon aria-hidden="true" />}
                  />
                )
              }
              label={
                draft.isSending
                  ? 'Sending message'
                  : mode === 'stop'
                    ? 'Stop response'
                    : hasSelectedModel || projection.isCompactCommand
                      ? 'Send message'
                      : 'Select an enabled model to send messages'
              }
              type={mode === 'stop' ? 'button' : 'submit'}
              variant={mode === 'stop' ? 'secondary' : 'default'}
              size="icon-lg"
              onClick={mode === 'stop' ? onStop : undefined}
            />
          </div>
          {draft.isSending ? (
            <span role="status" className="sr-only">
              Sending message
            </span>
          ) : null}
        </div>
      </div>
    </form>
  )
}

export { ChatComposer, type ChatComposerMode }
