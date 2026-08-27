import { Kbd, KbdGroup } from '@mico/ui'
import type { Meta, StoryObj } from '@storybook/react-vite'

const meta = {
  title: 'Components/Primitives/Kbd',
  component: Kbd,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  args: {
    children: '⌘'
  }
} satisfies Meta<typeof Kbd>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Shortcut: Story = {
  render: () => (
    <KbdGroup>
      <Kbd>⌘</Kbd>
      <Kbd>N</Kbd>
    </KbdGroup>
  )
}
