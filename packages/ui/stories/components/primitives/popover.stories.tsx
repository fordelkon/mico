import {
  Button,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from '@mico/ui'
import type { Meta, StoryObj } from '@storybook/react-vite'

const meta = {
  title: 'Components/Primitives/Popover',
  component: Popover,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs']
} satisfies Meta<typeof Popover>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">Open options</Button>
      </PopoverTrigger>
      <PopoverContent>
        <PopoverHeader>
          <PopoverTitle>Model options</PopoverTitle>
          <PopoverDescription>Choose the model for this conversation.</PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  )
}

export const ControlledOpen: Story = {
  render: () => (
    <Popover open>
      <PopoverTrigger asChild>
        <Button variant="outline">Always open</Button>
      </PopoverTrigger>
      <PopoverContent>
        <PopoverHeader>
          <PopoverTitle>Model options</PopoverTitle>
          <PopoverDescription>Controlled Popover content.</PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  )
}
