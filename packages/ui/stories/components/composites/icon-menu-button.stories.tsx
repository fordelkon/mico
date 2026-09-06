import { DropdownMenuItem, DropdownMenuSeparator, IconMenuButton } from '@mico/ui'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { MoreHorizontalIcon } from 'lucide-react'
import * as React from 'react'

const menuItems = (
  <>
    <DropdownMenuItem>Rename</DropdownMenuItem>
    <DropdownMenuItem>Duplicate</DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
  </>
)

function OpenStateStory(args: React.ComponentProps<typeof IconMenuButton>): React.JSX.Element {
  const [isOpen, setIsOpen] = React.useState(false)

  return (
    <div className="flex items-center gap-3">
      <IconMenuButton {...args} onOpenChange={setIsOpen}>
        {menuItems}
      </IconMenuButton>
      <output className="text-sm text-muted-foreground">{isOpen ? 'Open' : 'Closed'}</output>
    </div>
  )
}

const meta = {
  title: 'Components/Composites/IconMenuButton',
  component: IconMenuButton,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  args: {
    children: menuItems,
    icon: <MoreHorizontalIcon />,
    label: 'More actions'
  }
} satisfies Meta<typeof IconMenuButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      {(['icon-xs', 'icon-sm', 'icon', 'icon-lg'] as const).map((size) => (
        <IconMenuButton
          key={size}
          icon={<MoreHorizontalIcon />}
          label={`More actions (${size})`}
          size={size}
        >
          {menuItems}
        </IconMenuButton>
      ))}
    </div>
  )
}

export const CustomSvg: Story = {
  args: {
    icon: (
      <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
        <circle cx="5" cy="12" r="2" />
        <circle cx="12" cy="12" r="2" />
        <circle cx="19" cy="12" r="2" />
      </svg>
    )
  }
}

export const EndAligned: Story = {
  args: {
    menuAlign: 'end',
    menuContentClassName: 'w-64'
  }
}

export const OpenState: Story = {
  render: (args) => <OpenStateStory {...args} />
}

export const Disabled: Story = {
  args: {
    disabled: true
  }
}
