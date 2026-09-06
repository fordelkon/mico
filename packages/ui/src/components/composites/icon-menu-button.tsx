import { Button } from '@mico/ui/components/primitives/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@mico/ui/components/primitives/dropdown-menu'
import * as React from 'react'

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
  /** Called when the menu opens or closes. */
  onOpenChange?: (open: boolean) => void
  /** Horizontal alignment of the menu relative to its trigger. Defaults to `center`. */
  menuAlign?: React.ComponentProps<typeof DropdownMenuContent>['align']
  /** Additional classes for the menu content container. */
  menuContentClassName?: string
}

/** An accessible icon button that opens a menu below itself on click. */
function IconMenuButton({
  children,
  disabled,
  icon,
  label,
  menuAlign = 'center',
  menuContentClassName,
  onOpenChange,
  size = 'icon',
  variant = 'ghost',
  ...props
}: IconMenuButtonProps) {
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button aria-label={label} disabled={disabled} size={size} variant={variant} {...props}>
          {icon}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={menuAlign}
        className={menuContentClassName}
        side="bottom"
        sideOffset={4}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { IconMenuButton }
