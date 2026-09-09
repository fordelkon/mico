import { Button, SearchPopover } from '@mico/ui'
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
            className="max-h-56 overflow-y-auto p-1"
            role="listbox"
          >
            {filteredThemes.length === 0 ? (
              <p className="py-6 text-center text-sm text-text-secondary">No code themes found.</p>
            ) : (
              filteredThemes.map((id) => (
                <Button
                  aria-selected={id === value}
                  className="h-8 w-full justify-between rounded-sm px-2 text-left text-sm focus-visible:border-transparent focus-visible:bg-accent focus-visible:ring-0"
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
              ))
            )}
          </div>
        )
      }}
    </SearchPopover>
  )
}

export { CodeThemeMenu }
