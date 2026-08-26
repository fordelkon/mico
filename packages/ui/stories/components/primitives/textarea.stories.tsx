import { Textarea } from '@mico/ui'
import type { Meta, StoryObj } from '@storybook/react-vite'

const meta = {
  title: 'Components/Primitives/Textarea',
  component: Textarea,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[min(32rem,80vw)]">
        <Story />
      </div>
    )
  ],
  args: {
    'aria-label': 'Message',
    placeholder: 'Message Mico'
  }
} satisfies Meta<typeof Textarea>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithValue: Story = {
  args: {
    defaultValue: 'Help me plan the next step.'
  }
}

export const Disabled: Story = {
  args: {
    defaultValue: 'Streaming response in progress',
    disabled: true
  }
}

export const Invalid: Story = {
  args: {
    'aria-invalid': true,
    defaultValue: 'Message requires attention'
  }
}
