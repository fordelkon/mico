import * as React from 'react'

import { InputGroupInput } from '@mico/ui/components/primitives/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@mico/ui/components/primitives/popover'
import { cn } from '@mico/ui/lib/utils'
import { SearchIcon } from 'lucide-react'

type SearchPopoverRenderContext = {
  /** Closes the popover and clears the current query. */
  close: () => void
  /** Current search input value; filtering remains the caller's responsibility. */
  query: string
}

type SearchPopoverProps = {
  /** Alignment of the content relative to the trigger. */
  align?: React.ComponentProps<typeof PopoverContent>['align']
  /** Renders results for the query; the caller owns filtering and closes after selection. */
  children: (context: SearchPopoverRenderContext) => React.ReactNode
  /** Additional classes for width, height, or other content-specific layout. */
  contentClassName?: string
  /** Accessible name for the search input. */
  searchLabel: string
  /** Placeholder displayed when the query is empty. */
  searchPlaceholder: string
  /** Single interactive element that opens the popover. */
  trigger: React.ReactElement
}

/** A searchable popover that focuses its query on open and clears it on close. */
function SearchPopover({
  align,
  children,
  contentClassName,
  searchLabel,
  searchPlaceholder,
  trigger
}: SearchPopoverProps): React.JSX.Element {
  const [isOpen, setIsOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const searchRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    const animationFrame = isOpen ? requestAnimationFrame(() => searchRef.current?.focus()) : null
    return () => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame)
    }
  }, [isOpen])

  function handleOpenChange(open: boolean): void {
    setIsOpen(open)
    if (!open) setQuery('')
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className={cn('gap-0 overflow-hidden p-0', contentClassName)}>
        <div className="border-b border-border/70 px-3 transition-colors hover:bg-accent/40">
          <div className="flex h-10 items-center gap-2">
            <SearchIcon aria-hidden="true" className="size-4 shrink-0 opacity-50" />
            <InputGroupInput
              aria-label={searchLabel}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
                  event.stopPropagation()
                }
              }}
              placeholder={searchPlaceholder}
              ref={searchRef}
              value={query}
            />
          </div>
        </div>
        {children({ close: () => handleOpenChange(false), query })}
      </PopoverContent>
    </Popover>
  )
}

export { SearchPopover, type SearchPopoverProps, type SearchPopoverRenderContext }
