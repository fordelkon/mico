import {
  Bubble,
  BubbleContent,
  Message,
  MessageContent,
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '@mico/ui'
import type { Meta, StoryObj } from '@storybook/react-vite'

const messages = Array.from({ length: 16 }, (_, index) => ({
  id: `message-${index + 1}`,
  role: index % 2 === 0 ? ('assistant' as const) : ('user' as const),
  text:
    index % 2 === 0
      ? `Assistant response ${index + 1}: Here is a concise explanation with enough text to demonstrate scrolling.`
      : `User message ${index + 1}: Can you expand on that point?`
}))

const meta = {
  title: 'Components/Primitives/MessageScroller',
  component: MessageScroller,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs']
} satisfies Meta<typeof MessageScroller>

export default meta
type Story = StoryObj<typeof meta>

export const Conversation: Story = {
  render: () => (
    <div className="h-[32rem] w-[min(42rem,80vw)] overflow-hidden rounded-xl border bg-background">
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent className="p-4">
              {messages.map((message) => (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={message.role === 'user'}
                >
                  <Message align={message.role === 'user' ? 'end' : 'start'}>
                    <MessageContent>
                      <Bubble
                        align={message.role === 'user' ? 'end' : 'start'}
                        variant={message.role === 'user' ? 'default' : 'muted'}
                      >
                        <BubbleContent>{message.text}</BubbleContent>
                      </Bubble>
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
    </div>
  )
}
