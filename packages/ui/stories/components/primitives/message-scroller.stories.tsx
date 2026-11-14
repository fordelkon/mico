import {
  Bubble,
  BubbleContent,
  Button,
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
import * as React from 'react'

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

function StreamingConversation(): React.JSX.Element {
  const [responses, setResponses] = React.useState(messages)

  return (
    <div className="flex w-[min(42rem,80vw)] flex-col gap-3">
      <Button
        className="self-start"
        onClick={() =>
          setResponses((current) => [
            ...current,
            {
              id: `message-${current.length + 1}`,
              role: 'assistant',
              text: `Assistant response ${current.length + 1}: New content follows while you are at the bottom. Scroll up to read earlier messages, then jump to the end to resume following.`
            }
          ])
        }
      >
        Append response
      </Button>
      <div className="h-[32rem] overflow-hidden rounded-xl border bg-background">
        <MessageScrollerProvider autoScroll defaultScrollPosition="end">
          <MessageScroller>
            <MessageScrollerViewport>
              <MessageScrollerContent className="p-4">
                {responses.map((message) => (
                  <MessageScrollerItem key={message.id} messageId={message.id}>
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
    </div>
  )
}

export const Streaming: Story = {
  render: () => <StreamingConversation />
}

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
