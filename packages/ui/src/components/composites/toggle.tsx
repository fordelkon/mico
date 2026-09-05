import * as React from 'react'

import { Button } from '@mico/ui/components/primitives/button'
import { cn } from '@mico/ui/lib/utils'

type ToggleProps = Omit<
  React.ComponentProps<typeof Button>,
  'aria-checked' | 'asChild' | 'children' | 'onClick' | 'role' | 'size' | 'type' | 'variant'
> & {
  /** Whether the switch is on. */
  checked: boolean
  /** Called with the requested state after an enabled user interaction. */
  onCheckedChange: (checked: boolean) => void
}

/** An accessible, controlled switch with a double-bounce thumb transition. */
function Toggle({ checked, className, disabled, onCheckedChange, ...props }: ToggleProps) {
  const [hasInteracted, setHasInteracted] = React.useState(false)
  const [isOvershooting, setIsOvershooting] = React.useState(false)
  const transitionTimeout = React.useRef<number | undefined>(undefined)

  React.useEffect(() => {
    return () => window.clearTimeout(transitionTimeout.current)
  }, [])

  function handleClick() {
    setHasInteracted(true)
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      window.clearTimeout(transitionTimeout.current)
      setIsOvershooting(true)
      transitionTimeout.current = window.setTimeout(() => setIsOvershooting(false), 193)
    }
    onCheckedChange(!checked)
  }

  return (
    <Button
      aria-checked={checked}
      className={cn(
        'group/toggle relative h-5 w-8 rounded-full border border-border bg-secondary p-0 shadow-none transition-[background-color,border-color] duration-0 ease-[cubic-bezier(0.34,1.35,0.64,1)] hover:bg-secondary data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:hover:bg-primary/90',
        className
      )}
      data-init={hasInteracted || undefined}
      data-overshoot={isOvershooting || undefined}
      data-slot="toggle"
      data-state={checked ? 'checked' : 'unchecked'}
      disabled={disabled}
      onClick={handleClick}
      role="switch"
      type="button"
      variant="ghost"
      {...props}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-0.5 size-4 translate-x-0 rounded-full bg-surface-primary shadow-hairline transition-transform duration-[88ms] ease-out will-change-transform dark:bg-background group-data-[state=checked]/toggle:translate-x-[14.66px] group-data-[overshoot=true]/toggle:duration-[193ms] group-data-[overshoot=true]/toggle:ease-[cubic-bezier(0.34,1.35,0.64,1)] group-data-[overshoot=true]/toggle:group-data-[state=checked]/toggle:translate-x-[15.66px] group-data-[overshoot=true]/toggle:group-data-[state=unchecked]/toggle:-translate-x-px motion-reduce:transition-none"
        data-slot="toggle-thumb"
      />
    </Button>
  )
}

export { Toggle, type ToggleProps }
