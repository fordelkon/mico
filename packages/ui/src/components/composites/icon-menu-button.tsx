import * as React from 'react'

import { Button } from '@mico/ui/components/primitives/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@mico/ui/components/primitives/dropdown-menu'

type IconMenuButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  'children' | 'size' | 'variant' | 'aria-label' | 'onClick'
> & {
  /** Visual content rendered inside the icon-only button, including custom SVG elements. */
  icon: React.ReactNode
  /** Accessible button name. This component does not render a tooltip. */
  label: string
  /** Dropdown menu primitives rendered directly inside the menu content. */
  children: React.ReactNode
  /** Icon-only Button size. Defaults to `icon`. */
  size?: 'icon-xs' | 'icon-sm' | 'icon' | 'icon-lg'
  /** Visual Button treatment. Defaults to `ghost`. */
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link'
}

/** An accessible icon button that opens a centered menu below itself on click. */
function IconMenuButton({
  children,
  disabled,
  icon,
  label,
  size = 'icon',
  variant = 'ghost',
  ...props
}: IconMenuButtonProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button aria-label={label} disabled={disabled} size={size} variant={variant} {...props}>
          {icon}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" side="bottom" sideOffset={4}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { IconMenuButton }
