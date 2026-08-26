import { Bubble, BubbleContent, BubbleGroup, BubbleReactions } from '@mico/ui'
import type { Meta, StoryObj } from '@storybook/react-vite'

const meta = {
  title: 'Components/Primitives/Bubble',
  component: Bubble,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs']
} satisfies Meta<typeof Bubble>

export default meta
type Story = StoryObj<typeof meta>

export const Variants: Story = {
  render: () => (
    <BubbleGroup className="w-[min(36rem,80vw)]">
      {(
        ['default', 'secondary', 'muted', 'tinted', 'outline', 'ghost', 'destructive'] as const
      ).map((variant) => (
        <Bubble key={variant} variant={variant}>
          <BubbleContent>{variant} message bubble</BubbleContent>
        </Bubble>
      ))}
    </BubbleGroup>
  )
}

export const AlignedWithReaction: Story = {
  render: () => (
    <div className="w-[min(36rem,80vw)]">
      <Bubble align="end" variant="tinted">
        <BubbleContent>This answer was useful.</BubbleContent>
        <BubbleReactions>👍 2</BubbleReactions>
      </Bubble>
    </div>
  )
}
