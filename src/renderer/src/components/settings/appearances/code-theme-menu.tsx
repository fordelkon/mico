import { Button, SearchPopover } from '@mico/ui'
import { useGlidingHighlight } from '@renderer/hooks/use-gliding-highlight'
import { type Appearance, type CodeThemeId, getCodeThemeLabel } from '@shared/theme/theme-registry'
import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import * as React from 'react'

type CodeThemeMenuProps = {
  appearance: Appearance
  codeThemes: readonly CodeThemeId[]
  onValueChange: (value: CodeThemeId) => void
  value: CodeThemeId
}

function CodeThemeMenu({
  appearance,
  codeThemes,
  onValueChange,
  value
}: CodeThemeMenuProps): React.JSX.Element {
  const { clearHighlight, getItemProps, highlightProps } = useGlidingHighlight<HTMLButtonElement>()

  return (
    <SearchPopover
      align="end"
      contentClassName="w-64"
      searchLabel={`Search ${appearance} code themes`}
      searchPlaceholder="Search code themes"
      trigger={
        <Button
          aria-label={`${appearance} code theme`}
          className="h-8 min-w-36 justify-between px-2.5 text-sm"
          type="button"
          variant="outline"
        >
          {getCodeThemeLabel(value)}
          <ChevronDownIcon aria-hidden="true" className="size-3" />
        </Button>
      }
    >
      {({ close, query }) => {
        const filteredThemes = codeThemes.filter((id) =>
          getCodeThemeLabel(id).toLowerCase().includes(query.toLowerCase())
        )

        return (
          <div
            aria-label={`${appearance} code themes`}
            className="relative max-h-56 overflow-y-auto p-1"
            onMouseLeave={clearHighlight}
            role="listbox"
          >
            {filteredThemes.length === 0 ? (
              <p className="py-6 text-center text-sm text-text-secondary">No code themes found.</p>
            ) : (
              <>
                <span
                  {...highlightProps}
                  className={`${highlightProps.className} inset-x-1 rounded-sm bg-accent`}
                />
                {filteredThemes.map((id, index) => (
                  <Button
                    aria-selected={id === value}
                    {...getItemProps(index)}
                    className="relative z-10 h-8 w-full justify-between rounded-sm px-2 text-left text-sm hover:bg-transparent focus-visible:border-transparent focus-visible:bg-transparent focus-visible:ring-0"
                    key={id}
                    onClick={() => {
                      onValueChange(id)
                      close()
                    }}
                    role="option"
                    type="button"
                    variant="ghost"
                  >
                    {getCodeThemeLabel(id)}
                    {id === value ? <CheckIcon aria-hidden="true" className="size-4" /> : null}
                  </Button>
                ))}
              </>
            )}
          </div>
        )
      }}
    </SearchPopover>
  )
}

export { CodeThemeMenu }
