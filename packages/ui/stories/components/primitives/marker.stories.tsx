import { Marker, MarkerContent, MarkerIcon } from '@mico/ui'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { ArrowDownIcon } from 'lucide-react'

const meta = {
  title: 'Components/Primitives/Marker',
  component: Marker,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[min(36rem,80vw)]">
        <Story />
      </div>
    )
  ]
} satisfies Meta<typeof Marker>

export default meta
type Story = StoryObj<typeof meta>

export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <Marker>
        <MarkerIcon>
          <ArrowDownIcon />
        </MarkerIcon>
        <MarkerContent>New activity</MarkerContent>
      </Marker>
      <Marker variant="separator">
        <MarkerContent>Today</MarkerContent>
      </Marker>
      <Marker variant="border">
        <MarkerContent>3 unread messages</MarkerContent>
      </Marker>
    </div>
  )
}
