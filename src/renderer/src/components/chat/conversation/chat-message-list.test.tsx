import '@testing-library/jest-dom/vitest'

import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'

import type { MicoUIMessage } from '@renderer/types/chat'

import { ChatMessageList } from './chat-message-list'

afterEach(() => {
  vi.useRealTimers()
})

function RetryHarness(): React.JSX.Element {
  const [wasRetried, setWasRetried] = React.useState(false)

  if (wasRetried) return <output>Retry requested</output>

  return (
    <ChatMessageList
      conversationId="conversation-1"
      errorMessage="The chat provider could not complete the response."
      isResponding={false}
      messages={[]}
      onRetry={() => setWasRetried(true)}
    />
  )
}

describe('ChatMessageList', () => {
  it('does not revisit stable messages when the streaming message changes', () => {
    let stablePartsReads = 0
    const stableParts: MicoUIMessage['parts'] = [
      { type: 'text', text: 'Earlier message', state: 'done' }
    ]
    const stableMessage = {
      id: 'user-1',
      role: 'user' as const,
      get parts() {
        stablePartsReads += 1
        return stableParts
      }
    }
    const { rerender } = render(
      <ChatMessageList
        conversationId="conversation-1"
        isResponding
        messages={[
          stableMessage,
          {
            id: 'assistant-1',
            role: 'assistant',
            parts: [{ type: 'text', text: 'First chunk', state: 'streaming' }]
          }
        ]}
      />
    )
    const readsBeforeNextChunk = stablePartsReads

    rerender(
      <ChatMessageList
        conversationId="conversation-1"
        isResponding
        messages={[
          stableMessage,
          {
            id: 'assistant-1',
            role: 'assistant',
            parts: [{ type: 'text', text: 'First chunk, then more', state: 'streaming' }]
          }
        ]}
      />
    )

    expect(stablePartsReads).toBe(readsBeforeNextChunk)
  })

  it('does not revisit the transcript while the retry countdown advances', async () => {
    vi.useFakeTimers()
    class ObservableMessages extends Array<MicoUIMessage> {
      latestMessageReads = 0

      override at(index: number): MicoUIMessage | undefined {
        this.latestMessageReads += 1
        return super.at(index)
      }
    }
    const messages = new ObservableMessages()

    render(
      <ChatMessageList
        conversationId="conversation-1"
        isResponding={false}
        messages={messages}
        retry={{ attempt: 2, maxAttempts: 5, retryDelayMs: 2_000, startedAt: Date.now() }}
      />
    )
    const readsBeforeCountdownTick = messages.latestMessageReads

    await act(() => vi.advanceTimersByTimeAsync(250))

    expect(messages.latestMessageReads).toBe(readsBeforeCountdownTick)
  })

  it('keeps the pending thinking state until an assistant response has content', () => {
    const userMessage = {
      id: 'user-1',
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: 'What should I work on next?' }]
    }
    const { rerender } = render(
      <ChatMessageList conversationId="conversation-1" isResponding messages={[userMessage]} />
    )
    expect(screen.getByRole('button', { name: 'Thinking' })).toBeVisible()

    rerender(
      <ChatMessageList
        conversationId="conversation-1"
        isResponding
        messages={[userMessage, { id: 'assistant-1', role: 'assistant', parts: [] }]}
      />
    )

    expect(screen.getByRole('button', { name: 'Thinking' })).toBeVisible()

    rerender(
      <ChatMessageList
        conversationId="conversation-1"
        isResponding
        messages={[
          userMessage,
          {
            id: 'assistant-1',
            role: 'assistant',
            parts: [{ type: 'text', text: 'Start with the most important task.' }]
          }
        ]}
      />
    )

    expect(screen.queryByRole('button', { name: 'Thinking' })).toBeNull()
    expect(screen.getAllByTestId('answer-content').at(-1)).toHaveTextContent(
      'Start with the most important task.'
    )
  })

  it('shows a provider error as an alert', () => {
    render(
      <ChatMessageList
        conversationId="conversation-1"
        errorMessage="The chat provider could not complete the response."
        isResponding={false}
        messages={[]}
        onRetry={() => undefined}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The chat provider could not complete the response.'
    )
  })

  it('retries a failed response when requested', async () => {
    const user = userEvent.setup()
    render(<RetryHarness />)

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(screen.getByText('Retry requested')).toBeVisible()
  })

  it('shows the current retry attempt while reconnecting', () => {
    render(
      <ChatMessageList
        conversationId="conversation-1"
        isResponding
        messages={[]}
        retry={{ attempt: 2, maxAttempts: 5, retryDelayMs: 2_000, startedAt: Date.now() }}
      />
    )

    expect(screen.getByRole('status')).toHaveTextContent(
      'Connection interrupted. Retrying in 2s · attempt 2 of 5.'
    )
  })
})
