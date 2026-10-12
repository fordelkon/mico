import * as React from 'react'

import { Button } from '@mico/ui/components/primitives/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@mico/ui/components/primitives/tooltip'

type IconTooltipButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  'children' | 'size' | 'variant' | 'aria-label'
> & {
  /** Visual content rendered inside the icon-only button, including custom SVG elements. */
  icon: React.ReactNode
  /** Accessible button name and fallback tooltip content. */
  label: string
  /** Content shown on hover or focus. Defaults to `label` when omitted. */
  tooltip?: React.ReactNode
  /** Side of the tooltip relative to the button. Defaults to `top`. */
  tooltipSide?: React.ComponentProps<typeof TooltipContent>['side']
  /** Alignment of the tooltip along that side. Defaults to `center`. */
  tooltipAlign?: React.ComponentProps<typeof TooltipContent>['align']
  /** Distance between the tooltip and the button. Defaults to the Tooltip primitive's offset. */
  tooltipSideOffset?: React.ComponentProps<typeof TooltipContent>['sideOffset']
  /**
   * Hides the tooltip entirely, for example while a menu opened from this
   * button is open; the caller owns that open state.
   */
  tooltipDisabled?: boolean
  /** Icon-only Button size. Defaults to `icon`. */
  size?: 'icon-xs' | 'icon-sm' | 'icon' | 'icon-lg'
  /** Visual Button treatment. Defaults to `ghost`. */
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link'
}

/** An accessible icon button with a tooltip (top by default) and a 500ms hover delay. */
function IconTooltipButton({
  icon,
  label,
  tooltip = label,
  tooltipAlign,
  tooltipDisabled = false,
  tooltipSide = 'top',
  tooltipSideOffset,
  size = 'icon',
  variant = 'ghost',
  ...props
}: IconTooltipButtonProps) {
  return (
    <TooltipProvider delayDuration={500}>
      <Tooltip open={tooltipDisabled ? false : undefined}>
        <TooltipTrigger asChild>
          <Button aria-label={label} size={size} variant={variant} {...props}>
            {icon}
          </Button>
        </TooltipTrigger>
        {tooltipDisabled ? null : (
          <TooltipContent
            align={tooltipAlign}
            className="[--tw-enter-scale:.98] [--tw-exit-scale:.98] data-[state=delayed-open]:[animation-duration:150ms] data-[state=delayed-open]:[animation-timing-function:ease-out] data-[state=instant-open]:[animation-duration:150ms] data-[state=instant-open]:[animation-timing-function:ease-out] data-[state=closed]:[animation-duration:50ms] data-[state=closed]:[animation-timing-function:ease-out] motion-reduce:animate-none"
            side={tooltipSide}
            sideOffset={tooltipSideOffset}
          >
            {tooltip}
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  )
}

export { IconTooltipButton }
