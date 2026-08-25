import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@mico/ui'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { MessageCircleDashedIcon, PlusIcon } from 'lucide-react'

const meta = {
  title: 'Components/Primitives/Empty',
  component: Empty,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="flex h-80 w-[min(36rem,80vw)] rounded-xl border">
        <Story />
      </div>
    )
  ]
} satisfies Meta<typeof Empty>

export default meta
type Story = StoryObj<typeof meta>

export const Chat: Story = {
  render: () => (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessageCircleDashedIcon />
        </EmptyMedia>
        <EmptyTitle>Start a conversation</EmptyTitle>
        <EmptyDescription>Message Mico when you are ready.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export const WithAction: Story = {
  render: () => (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessageCircleDashedIcon />
        </EmptyMedia>
        <EmptyTitle>No saved prompts</EmptyTitle>
        <EmptyDescription>Create a prompt to reuse it in future conversations.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button>
          <PlusIcon />
          Create prompt
        </Button>
      </EmptyContent>
    </Empty>
  )
}
