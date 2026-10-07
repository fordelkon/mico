import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@mico/ui'
import { CircleOffIcon, LightbulbIcon } from 'lucide-react'
import * as React from 'react'

import type { ModelReasoningCapabilities, ThinkingSelection } from '@shared/data/schemas/chat'

import { useGlidingHighlight } from '@renderer/hooks/use-gliding-highlight'

type ThinkingSelectorProps = {
  disabled: boolean
  onValueChange: (selection: ThinkingSelection) => void
  reasoningCapabilities: ModelReasoningCapabilities
  value: ThinkingSelection
}

const labels = {
  none: 'Off',
  auto: 'On',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max'
} satisfies Record<Exclude<ThinkingSelection, 'default'>, string>

const descriptions = {
  none: 'Disable extended thinking',
  auto: 'Let the model choose the right amount of reasoning',
  minimal: 'Fastest responses for straightforward tasks',
  low: 'Quick responses with minimal reasoning',
  medium: 'Balanced speed and reasoning depth.',
  high: 'Deep reasoning for complex tasks',
  xhigh: 'Extra reasoning for the hardest tasks',
  max: 'Maximum reasoning for the most demanding tasks'
} satisfies Record<Exclude<ThinkingSelection, 'default'>, string>

function ThinkingSelector({
  disabled,
  onValueChange,
  reasoningCapabilities,
  value
}: ThinkingSelectorProps): React.JSX.Element {
  const { clearHighlight, getItemProps, highlightProps } = useGlidingHighlight<HTMLElement>()
  const selected = value === 'default' ? 'auto' : value

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`Thinking effort: ${labels[selected]}`}
          className="h-8 gap-1.5 px-2 text-xs font-normal text-text-secondary"
          disabled={disabled}
          type="button"
          variant="ghost"
        >
          <span>{labels[selected]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-80 max-w-[calc(100vw-2rem)] p-2"
        side="top"
        sideOffset={8}
      >
        <DropdownMenuLabel className="px-2 py-1.5">
          <p className="text-sm font-semibold text-foreground">Reasoning</p>
          <p className="mt-1 text-xs font-normal leading-5 text-muted-foreground">
            Adjust the reasoning effort for models that support extended thinking.
          </p>
        </DropdownMenuLabel>
        <div className="relative" onMouseLeave={clearHighlight}>
          <span
            {...highlightProps}
            className={`${highlightProps.className} inset-x-1 rounded-md bg-accent`}
          />
          <DropdownMenuRadioGroup
            value={value}
            // SAFETY: Every selectable item is rendered with a canonical thinking-effort value.
            onValueChange={(selection) => onValueChange(selection as ThinkingSelection)}
          >
            {reasoningCapabilities.selectableEfforts.map((selection, index) => (
              <DropdownMenuRadioItem
                {...getItemProps(index)}
                className="relative z-10 min-h-14 items-start gap-2 rounded-md px-2 py-2 pr-8 hover:bg-transparent focus:bg-transparent"
                key={selection}
                value={selection}
              >
                {selection === 'none' ? (
                  <CircleOffIcon aria-hidden="true" className="mt-0.5 size-4" />
                ) : (
                  <LightbulbIcon aria-hidden="true" className="mt-0.5 size-4" />
                )}
                <span className="grid gap-0.5">
                  <span className="font-medium">{labels[selection]}</span>
                  <span className="text-xs leading-4 text-muted-foreground">
                    {descriptions[selection]}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { ThinkingSelector }
