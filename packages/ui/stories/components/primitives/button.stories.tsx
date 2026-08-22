import { Button } from '@mico/ui'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { ArrowRightIcon } from 'lucide-react'

const meta = {
  title: 'Components/Primitives/Button',
  component: Button,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  args: {
    children: 'Button'
  }
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button>Default</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="link">Link</Button>
    </div>
  )
}

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="xs">Extra small</Button>
      <Button size="sm">Small</Button>
      <Button>Default</Button>
      <Button size="lg">Large</Button>
    </div>
  )
}

export const IconSizes: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      {(['icon-xs', 'icon-sm', 'icon', 'icon-lg'] as const).map((size) => (
        <Button key={size} size={size} variant="outline" aria-label={`${size} arrow`}>
          <ArrowRightIcon />
        </Button>
      ))}
    </div>
  )
}

export const Disabled: Story = {
  args: {
    disabled: true
  }
}

export const AsChild: Story = {
  render: () => (
    <Button asChild variant="outline">
      <a href="#button-as-child">Open link</a>
    </Button>
  )
}
