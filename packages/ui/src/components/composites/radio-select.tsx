import { Button } from '@mico/ui/components/primitives/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@mico/ui/components/primitives/dropdown-menu'
import { cn } from '@mico/ui/lib/utils'
import { ChevronDownIcon } from 'lucide-react'
import * as React from 'react'

type RadioSelectOption<Value extends string> = {
  /** Content displayed in the trigger and its menu item. */
  label: React.ReactNode
  /** Stable value returned when the option is selected. */
  value: Value
}

type RadioSelectProps<Value extends string> = {
  /** Accessible name for the menu trigger. */
  'aria-label': string
  /** Called with the selected option value. */
  onValueChange: (value: Value) => void
  /** Choices available in the menu. */
  options: readonly RadioSelectOption<Value>[]
  /** Value of the selected option. */
  value: Value
  /** Additional classes for the trigger button. */
  className?: string
  /** Additional classes for the menu content. */
  contentClassName?: string
  /** Whether the trigger and menu are unavailable. */
  disabled?: boolean
}

/** A controlled button that selects one option from a dropdown menu. */
function RadioSelect<Value extends string>({
  'aria-label': ariaLabel,
  className,
  contentClassName,
  disabled = false,
  onValueChange,
  options,
  value
}: RadioSelectProps<Value>): React.JSX.Element {
  const selectedOption = options.find((option) => option.value === value)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          aria-label={ariaLabel}
          className={cn('w-fit justify-between', className)}
          disabled={disabled}
          type="button"
          variant="outline"
        >
          {selectedOption?.label}
          <ChevronDownIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className={cn('w-max max-w-[calc(100vw-4rem)]', contentClassName)}>
        <DropdownMenuRadioGroup
          onValueChange={(nextValue) => {
            const nextOption = options.find((option) => option.value === nextValue)
            if (nextOption) onValueChange(nextOption.value)
          }}
          value={value}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export type { RadioSelectOption, RadioSelectProps }
export { RadioSelect }
