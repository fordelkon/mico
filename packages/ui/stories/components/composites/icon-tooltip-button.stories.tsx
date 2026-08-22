import { IconTooltipButton } from '@mico/ui'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { HeartIcon, PlusIcon } from 'lucide-react'

const meta = {
  title: 'Components/Composites/IconTooltipButton',
  component: IconTooltipButton,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  args: {
    icon: <PlusIcon />,
    label: 'Add item'
  }
} satisfies Meta<typeof IconTooltipButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const CustomTooltip: Story = {
  args: {
    icon: <HeartIcon />,
    label: 'Favorite',
    tooltip: 'Add to favorites'
  }
}

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      {(['icon-xs', 'icon-sm', 'icon', 'icon-lg'] as const).map((size) => (
        <IconTooltipButton
          key={size}
          icon={<PlusIcon />}
          label={`Add item (${size})`}
          size={size}
        />
      ))}
    </div>
  )
}

export const CustomSvg: Story = {
  args: {
    icon: (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <path d="M5 12h14M12 5v14" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
      </svg>
    ),
    label: 'Create'
  }
}

export const Disabled: Story = {
  args: {
    disabled: true
  }
}
