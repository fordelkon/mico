import '@testing-library/jest-dom/vitest'

import { act, render, screen } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
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

function renderMessageList(
  overrides: Partial<React.ComponentProps<typeof ChatMessageList>> = {}
): RenderResult {
  return render(
    <ChatMessageList
      conversationId="conversation-1"
      isResponding={false}
      messages={[]}
      {...overrides}
    />
  )
}

describe('ChatMessageList', () => {
  it('user reads earlier messages undisturbed when new content streams, then the transcript stays stable', () => {
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
    const { rerender } = renderMessageList({
      isResponding: true,
      messages: [
        stableMessage,
        {
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'First chunk', state: 'streaming' }]
        }
      ]
    })
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

  it('user sees the transcript hold still when the retry countdown advances, then nothing flickers', async () => {
    vi.useFakeTimers()
    class ObservableMessages extends Array<MicoUIMessage> {
      latestMessageReads = 0

      override at(index: number): MicoUIMessage | undefined {
        this.latestMessageReads += 1
        return super.at(index)
      }
    }
    const messages = new ObservableMessages()

    renderMessageList({
      messages,
      retry: { attempt: 2, maxAttempts: 5, retryDelayMs: 2_000, startedAt: Date.now() }
    })
    const readsBeforeCountdownTick = messages.latestMessageReads

    await act(() => vi.advanceTimersByTimeAsync(250))

    expect(messages.latestMessageReads).toBe(readsBeforeCountdownTick)
  })

  it('user sees a pending thinking state when the response has no content, then it clears on text', () => {
    const userMessage = {
      id: 'user-1',
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: 'What should I work on next?' }]
    }
    const { rerender } = renderMessageList({ isResponding: true, messages: [userMessage] })
    expect(screen.getByTestId('thinking-orb')).toBeVisible()

    rerender(
      <ChatMessageList
        conversationId="conversation-1"
        isResponding
        messages={[userMessage, { id: 'assistant-1', role: 'assistant', parts: [] }]}
      />
    )

    expect(screen.getByTestId('thinking-orb')).toBeVisible()

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

    expect(screen.queryByTestId('thinking-orb')).toBeNull()
    expect(screen.getAllByTestId('answer-content').at(-1)).toHaveTextContent(
      'Start with the most important task.'
    )
  })

  it('user sees no pending thinking state when the effort is off, then the control is absent', () => {
    const userMessage = {
      id: 'user-1',
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: 'What should I work on next?' }]
    }

    renderMessageList({ isResponding: true, isThinkingEnabled: false, messages: [userMessage] })

    expect(screen.queryByRole('button', { name: 'Thinking' })).toBeNull()
  })

  it('user sees a provider error when the response fails, then an alert announces it', () => {
    renderMessageList({
      errorMessage: 'The chat provider could not complete the response.',
      onRetry: () => undefined
    })

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The chat provider could not complete the response.'
    )
  })

  it('user retries the response when pressing Try again, then the retry callback runs', async () => {
    const user = userEvent.setup()
    render(<RetryHarness />)

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(screen.getByText('Retry requested')).toBeVisible()
  })

  it('user sees the retry attempt when the connection drops, then the status shows a countdown', () => {
    renderMessageList({
      isResponding: true,
      retry: { attempt: 2, maxAttempts: 5, retryDelayMs: 2_000, startedAt: Date.now() }
    })

    expect(screen.getByRole('status')).toHaveTextContent(
      'Connection interrupted. Retrying in 2s · attempt 2 of 5.'
    )
  })
})
