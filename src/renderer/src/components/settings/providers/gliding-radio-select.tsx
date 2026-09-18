import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  type RadioSelectOption
} from '@mico/ui'
import { useGlidingHighlight } from '@renderer/hooks/use-gliding-highlight'
import { ChevronDownIcon } from 'lucide-react'
import * as React from 'react'

type GlidingRadioSelectProps<Value extends string> = {
  'aria-label': string
  className?: string
  contentClassName?: string
  disabled?: boolean
  onValueChange: (value: Value) => void
  options: readonly RadioSelectOption<Value>[]
  value: Value
}

function GlidingRadioSelect<Value extends string>({
  'aria-label': ariaLabel,
  className,
  contentClassName,
  disabled = false,
  onValueChange,
  options,
  value
}: GlidingRadioSelectProps<Value>): React.JSX.Element {
  const selectedOption = options.find((option) => option.value === value)
  const { clearHighlight, getItemProps, highlightProps } = useGlidingHighlight<HTMLElement>()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          aria-label={ariaLabel}
          className={`w-fit justify-between ${className ?? ''}`}
          disabled={disabled}
          type="button"
          variant="outline"
        >
          {selectedOption?.label}
          <ChevronDownIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className={`w-max max-w-[calc(100vw-4rem)] ${contentClassName ?? ''}`}>
        <DropdownMenuRadioGroup
          className="relative"
          onMouseLeave={clearHighlight}
          onValueChange={(nextValue) => {
            const nextOption = options.find((option) => option.value === nextValue)
            if (nextOption) onValueChange(nextOption.value)
          }}
          value={value}
        >
          <span
            {...highlightProps}
            className={`${highlightProps.className} inset-x-0 rounded-md bg-accent`}
          />
          {options.map((option, index) => (
            <DropdownMenuRadioItem
              {...getItemProps(index)}
              className="relative z-10 hover:bg-transparent focus:bg-transparent"
              key={option.value}
              value={option.value}
            >
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { GlidingRadioSelect, type GlidingRadioSelectProps }
