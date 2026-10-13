import { Button, IconSwap } from '@mico/ui'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { ArrowLeftIcon, BrainIcon, SquarePenIcon } from 'lucide-react'
import { useArgs } from 'storybook/preview-api'

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

export const Interactive: Story = {
  render: function Render(args) {
    const [{ state }, updateArgs] = useArgs<typeof args>()

    return (
      <div className="flex items-center gap-4">
        <IconSwap {...args} state={state} />
        <Button
          onClick={() => updateArgs({ state: state === 'from' ? 'to' : 'from' })}
          variant="outline"
        >
          {state === 'from' ? 'Show To icon' : 'Show From icon'}
        </Button>
      </div>
    )
  }
}

export const ThinkingToSummary: Story = {
  args: {
    from: <span className="size-4 rounded-full bg-brand" />,
    state: 'to',
    to: <BrainIcon />
  }
}
