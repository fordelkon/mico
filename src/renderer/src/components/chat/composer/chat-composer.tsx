import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  IconMenuButton,
  IconTooltipButton,
  IconSwap,
  Textarea
} from '@mico/ui'
import { ArrowUpIcon, BrainIcon, FolderIcon, FolderPlusIcon, SquareIcon } from 'lucide-react'
import * as React from 'react'

import type { ModelReasoningCapabilities, ThinkingSelection } from '@shared/data/schemas/chat'

import { ChatModelSelector } from './chat-model-selector'
import { useComposerModelSelection } from './use-composer-model-selection'

type ChatComposerMode = 'disabled' | 'send' | 'stop'

type ChatComposerProps = {
  canAddProject?: boolean
  focusKey: number
  mode: ChatComposerMode
  onModelSelected: () => Promise<void>
  onAddProject?: () => Promise<void>
  projectLabel?: string | null
  selectedModelEntryId?: string | null
  selectSessionModel?: (modelEntryId: string) => Promise<void>
  onSend: (content: string) => void
  onStop: () => void
  reasoningCapabilities: ModelReasoningCapabilities | null
  thinkingEffort: ThinkingSelection
  onThinkingEffortChange: (selection: ThinkingSelection) => void
}

const thinkingEffortLabels = {
  none: 'Off',
  auto: 'On',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max'
} satisfies Record<Exclude<ThinkingSelection, 'default'>, string>

const rotatingPlaceholders = [
  'Ask Mico to explain a concept…',
  'Plan a project step by step…',
  'Brainstorm your next idea…'
]

function ChatComposer({
  canAddProject = false,
  focusKey,
  mode,
  onModelSelected,
  onAddProject,
  projectLabel,
  selectedModelEntryId,
  selectSessionModel,
  onSend,
  onStop,
  reasoningCapabilities,
  thinkingEffort,
  onThinkingEffortChange
}: ChatComposerProps): React.JSX.Element {
  const { currentModelId, hasSelectedModel, library, selectionError, selectModel } =
    useComposerModelSelection({ onModelSelected, selectedModelEntryId, selectSessionModel })
  const [draft, setDraft] = React.useState('')
  const [isFocused, setIsFocused] = React.useState(false)
  const [placeholderIndex, setPlaceholderIndex] = React.useState(0)
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const mountedRef = React.useRef(false)
  const previousFocusKeyRef = React.useRef(focusKey)
  const previousModeRef = React.useRef(mode)
  const isDisabled = mode === 'disabled'
  const showRotatingPlaceholder =
    canAddProject && mode === 'send' && !draft && !isFocused && !prefersReducedMotion

  React.useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updatePreference = (): void => setPrefersReducedMotion(mediaQuery.matches)

    mediaQuery.addEventListener('change', updatePreference)
    return () => mediaQuery.removeEventListener('change', updatePreference)
  }, [])

  React.useEffect(() => {
    if (!showRotatingPlaceholder) return

    const interval = window.setInterval(() => {
      setPlaceholderIndex((current) => (current + 1) % rotatingPlaceholders.length)
    }, 4_500)

    return () => window.clearInterval(interval)
  }, [showRotatingPlaceholder])

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
  }, [draft])

  const submit = (): void => {
    if (mode !== 'send' || !hasSelectedModel || !draft.trim()) return

    onSend(draft)
    setDraft('')
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form
      className="chat-composer shrink-0 px-4 pb-5 pt-3 sm:px-6"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="chat-composer__surface mx-auto flex w-full max-w-[50rem] flex-col gap-2 rounded-[var(--radius-composer)] border border-border-subtle bg-chat-composer p-3 shadow-hairline transition-colors focus-within:border-border-strong">
        <div className="relative">
          <Textarea
            className="min-h-16 max-h-40 resize-none border-0 px-2 py-2.5 text-[15px] leading-6 shadow-none placeholder:text-muted-foreground/80 focus-visible:border-transparent focus-visible:ring-0 disabled:bg-transparent dark:bg-transparent"
            ref={textareaRef}
            disabled={isDisabled}
            onBlur={() => setIsFocused(false)}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={() => setIsFocused(true)}
            onKeyDown={handleKeyDown}
            placeholder={showRotatingPlaceholder ? '' : 'Ask Mico anything…'}
            value={draft}
          />
          {showRotatingPlaceholder ? (
            <span
              aria-hidden="true"
              className="chat-composer__suggestion pointer-events-none absolute left-2 top-2.5 max-w-[calc(100%-1rem)] truncate text-[15px] leading-6 text-muted-foreground/80"
              key={placeholderIndex}
            >
              {rotatingPlaceholders[placeholderIndex]}
            </span>
          ) : null}
        </div>
        <div className="flex min-h-8 items-center justify-between gap-4 px-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            {canAddProject && onAddProject ? (
              <IconTooltipButton
                className="size-8"
                icon={<FolderPlusIcon aria-hidden="true" />}
                label="Choose workspace"
                onClick={() => void onAddProject()}
                type="button"
                variant="ghost"
              />
            ) : null}
            {projectLabel ? (
              <span
                aria-label={`Workspace: ${projectLabel}`}
                className="inline-flex size-8 shrink-0 items-center justify-center text-muted-foreground"
                role="img"
                title={`Workspace: ${projectLabel}`}
              >
                <FolderIcon aria-hidden="true" className="size-4" />
              </span>
            ) : null}
            <div className="flex flex-col gap-1">
              <ChatModelSelector
                library={library}
                onSelect={selectModel}
                selectedModelId={currentModelId}
              />
              {selectionError ? (
                <p className="px-2 text-xs text-destructive">{selectionError}</p>
              ) : null}
            </div>
            {reasoningCapabilities ? (
              <IconMenuButton
                className={
                  thinkingEffort === 'none'
                    ? 'size-8'
                    : 'size-8 bg-accent text-accent-foreground hover:bg-accent'
                }
                disabled={mode !== 'send'}
                icon={<BrainIcon aria-hidden="true" />}
                label="Thinking effort"
                type="button"
                variant="secondary"
              >
                <DropdownMenuRadioGroup
                  value={thinkingEffort}
                  // SAFETY: Every selectable item is rendered with a canonical thinking-effort value.
                  onValueChange={(selection) =>
                    onThinkingEffortChange(selection as ThinkingSelection)
                  }
                >
                  {reasoningCapabilities.selectableEfforts.map((selection) => (
                    <DropdownMenuRadioItem key={selection} value={selection}>
                      {thinkingEffortLabels[selection]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </IconMenuButton>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center">
            <IconTooltipButton
              className="size-9"
              disabled={
                mode === 'disabled' || (mode === 'send' && (!hasSelectedModel || !draft.trim()))
              }
              icon={
                <IconSwap
                  from={<ArrowUpIcon aria-hidden="true" />}
                  state={mode === 'stop' ? 'to' : 'from'}
                  to={<SquareIcon aria-hidden="true" />}
                />
              }
              label={
                mode === 'stop'
                  ? 'Stop response'
                  : hasSelectedModel
                    ? 'Send message'
                    : 'Select an enabled model to send messages'
              }
              type={mode === 'stop' ? 'button' : 'submit'}
              variant={mode === 'stop' ? 'secondary' : 'default'}
              size="icon-lg"
              onClick={mode === 'stop' ? onStop : undefined}
            />
          </div>
        </div>
      </div>
    </form>
  )
}

export { ChatComposer, type ChatComposerMode }
