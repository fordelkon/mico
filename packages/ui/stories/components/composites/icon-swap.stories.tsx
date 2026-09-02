import { IconSwap } from '@mico/ui'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { ArrowLeftIcon, BrainIcon, SquarePenIcon } from 'lucide-react'

const meta = {
  title: 'Components/Composites/IconSwap',
  component: IconSwap,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  args: {
    from: <SquarePenIcon />,
    state: 'from',
    to: <ArrowLeftIcon />
  }
} satisfies Meta<typeof IconSwap>

export default meta
type Story = StoryObj<typeof meta>

export const From: Story = {}

export const To: Story = {
  args: {
    state: 'to'
  }
}

export const ThinkingToSummary: Story = {
  args: {
    from: <span className="size-4 rounded-full bg-brand" />,
    state: 'to',
    to: <BrainIcon />
  }
}
