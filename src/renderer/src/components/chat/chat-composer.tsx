import { IconTooltipButton, Textarea } from '@mico/ui'
import { ArrowUpIcon, SquareIcon } from 'lucide-react'
import * as React from 'react'

type ChatComposerMode = 'disabled' | 'send' | 'stop'

type ChatComposerProps = {
  focusKey: number
  mode: ChatComposerMode
  onSend: (content: string) => void
  onStop: () => void
}

function ChatComposer({ focusKey, mode, onSend, onStop }: ChatComposerProps): React.JSX.Element {
  const [draft, setDraft] = React.useState('')
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const mountedRef = React.useRef(false)
  const previousFocusKeyRef = React.useRef(focusKey)
  const previousModeRef = React.useRef(mode)
  const isDisabled = mode === 'disabled'

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

  const submit = (): void => {
    if (mode !== 'send' || !draft.trim()) return

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
      className="chat-composer shrink-0 px-4 pb-6 pt-3 sm:px-6"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="chat-composer__surface mx-auto flex w-full max-w-[46rem] flex-col gap-1.5 rounded-[var(--radius-composer)] border border-border-subtle bg-chat-composer p-2.5 shadow-hairline transition-colors focus-within:border-border-strong">
        <Textarea
          className="min-h-14 max-h-40 resize-none border-0 px-2.5 py-2 font-display text-[15px] leading-6 shadow-none placeholder:text-muted-foreground/80 focus-visible:border-transparent focus-visible:ring-0 disabled:bg-transparent"
          ref={textareaRef}
          disabled={isDisabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message Mico Today"
          value={draft}
        />
        {mode === 'stop' ? (
          <IconTooltipButton
            className="size-8 self-end"
            icon={<SquareIcon aria-hidden="true" />}
            label="Stop response"
            variant="secondary"
            type="button"
            onClick={onStop}
          />
        ) : (
          <IconTooltipButton
            className="size-8 self-end"
            disabled={mode === 'disabled' || !draft.trim()}
            icon={<ArrowUpIcon aria-hidden="true" />}
            label="Send message"
            type="submit"
            variant="default"
          />
        )}
      </div>
    </form>
  )
}

export { ChatComposer, type ChatComposerMode }
