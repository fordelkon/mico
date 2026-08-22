import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@mico/ui'
import type { Meta, StoryObj } from '@storybook/react-vite'

const meta = {
  title: 'Components/Primitives/Tooltip',
  component: Tooltip,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    )
  ]
} satisfies Meta<typeof Tooltip>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline">Hover or focus</Button>
      </TooltipTrigger>
      <TooltipContent>View details</TooltipContent>
    </Tooltip>
  )
}

export const Sides: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-8 p-16">
      {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
        <Tooltip key={side} defaultOpen>
          <TooltipTrigger asChild>
            <Button variant="outline">{side}</Button>
          </TooltipTrigger>
          <TooltipContent side={side}>{side} tooltip</TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

export const ControlledOpen: Story = {
  render: () => (
    <Tooltip open>
      <TooltipTrigger asChild>
        <Button variant="outline">Always open</Button>
      </TooltipTrigger>
      <TooltipContent side="top">Controlled tooltip</TooltipContent>
    </Tooltip>
  )
}
