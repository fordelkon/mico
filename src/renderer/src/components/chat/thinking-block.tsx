import { Button } from '@mico/ui'
import { BrainIcon } from 'lucide-react'
import * as React from 'react'

type ThinkingBlockProps = {
  id: string
  isStreaming: boolean
  text: string
}

function ThinkingBlock({ id, isStreaming, text }: ThinkingBlockProps): React.JSX.Element | null {
  const [expanded, setExpanded] = React.useState(isStreaming)
  const contentId = `thinking-${id}`

  if (!text) return null

  return (
    <section className="max-w-[42rem] text-sm text-text-tertiary">
      <Button
        aria-controls={contentId}
        aria-expanded={expanded}
        className="h-auto gap-2 px-0 py-1 text-text-tertiary hover:bg-transparent hover:text-foreground"
        variant="ghost"
        onClick={() => setExpanded((current) => !current)}
      >
        <BrainIcon aria-hidden="true" className="size-3.5" />
        {isStreaming && (
          <span
            aria-label="Thinking"
            className="size-2 animate-pulse rounded-full bg-brand"
            role="status"
          />
        )}
        Thinking
      </Button>
      {expanded && (
        <div
          className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-surface-secondary px-3 py-2"
          id={contentId}
        >
          {text}
        </div>
      )}
    </section>
  )
}

export { ThinkingBlock }
