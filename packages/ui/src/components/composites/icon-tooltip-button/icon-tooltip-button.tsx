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
  /** Icon-only Button size. Defaults to `icon`. */
  size?: 'icon-xs' | 'icon-sm' | 'icon' | 'icon-lg'
  /** Visual Button treatment. Defaults to `ghost`. */
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link'
}

/** An accessible icon button with a fixed top tooltip and a 500ms hover delay. */
function IconTooltipButton({
  icon,
  label,
  tooltip = label,
  size = 'icon',
  variant = 'ghost',
  ...props
}: IconTooltipButtonProps) {
  return (
    <TooltipProvider delayDuration={500}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button aria-label={label} size={size} variant={variant} {...props}>
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export { IconTooltipButton, type IconTooltipButtonProps }
