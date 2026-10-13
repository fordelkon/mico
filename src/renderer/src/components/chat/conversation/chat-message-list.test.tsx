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
  it('user receives another streamed chunk when earlier messages are unchanged, then their parts are not read again and the new chunk renders', () => {
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
    expect(screen.getAllByTestId('answer-content').at(-1)).toHaveTextContent(
      'First chunk, then more'
    )
  })

  it('user waits through a retry countdown when its timer advances, then the countdown ticks and the transcript is not read again', async () => {
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
    const visibleCountdown = (): string => {
      const countdown = screen.getByText(/^Retrying in \d+s/)
      return countdown.textContent ?? ''
    }
    expect(visibleCountdown()).toBe('Retrying in 2s · attempt 2 of 5.')
    const readsBeforeCountdownTick = messages.latestMessageReads

    await act(() => vi.advanceTimersByTimeAsync(1_500))

    expect(visibleCountdown()).toBe('Retrying in 1s · attempt 2 of 5.')
    expect(messages.latestMessageReads).toBe(readsBeforeCountdownTick)
  })

  it('user sees a pending thinking state when the response has no content, then it clears on text', () => {
    const userMessage = {
      id: 'user-1',
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: 'What should I work on next?' }]
    }
    const { rerender } = renderMessageList({ isResponding: true, messages: [userMessage] })
    expect(screen.getByRole('status')).toBeVisible()

    rerender(
      <ChatMessageList
        conversationId="conversation-1"
        isResponding
        messages={[userMessage, { id: 'assistant-1', role: 'assistant', parts: [] }]}
      />
    )

    expect(screen.getByRole('status')).toBeVisible()

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

    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getAllByTestId('answer-content').at(-1)).toHaveTextContent(
      'Start with the most important task.'
    )
  })

  it('user sees a working status when the effort is off and nothing streams yet, then the wait stays visible', () => {
    const userMessage = {
      id: 'user-1',
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: 'What should I work on next?' }]
    }

    renderMessageList({ isResponding: true, isThinkingEnabled: false, messages: [userMessage] })

    // The pending row stays visible without thinking; it just stops claiming "Thinking".
    expect(screen.getByRole('status')).toHaveTextContent('Working')
    expect(screen.queryByRole('button', { name: 'Thinking' })).toBeNull()
  })

  it('user sees a neutral interruption heading when the response fails, then the provider message and retry remain', () => {
    renderMessageList({
      errorMessage: 'The chat provider could not complete the response.',
      onRetry: () => undefined
    })

    const outcome = screen.getByRole('alert')
    expect(outcome).toHaveTextContent('Response interrupted')
    expect(outcome).toHaveTextContent('The chat provider could not complete the response.')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
  })

  it('user retries the response when pressing Try again, then the retry callback runs', async () => {
    const user = userEvent.setup()
    render(<RetryHarness />)

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(screen.getByText('Retry requested')).toBeVisible()
  })

  it('user hears one stable retry announcement when the countdown ticks, then it is not repeated', () => {
    vi.useFakeTimers()
    renderMessageList({
      isResponding: true,
      retry: { attempt: 2, maxAttempts: 5, retryDelayMs: 2_000, startedAt: Date.now() }
    })

    const retryStatus = (): HTMLElement => {
      const status = screen
        .getAllByRole('status')
        .find((element) => element.textContent?.includes('attempt'))
      if (!status) throw new Error('Retry announcement is missing.')
      return status
    }
    expect(retryStatus()).toHaveTextContent('Retrying · attempt 2 of 5.')
    const announcedBeforeTick = retryStatus().textContent

    act(() => {
      vi.advanceTimersByTime(250)
    })

    expect(retryStatus().textContent).toBe(announcedBeforeTick)
    expect(screen.getByTestId('retry-progress')).toBeVisible()
  })

  it.each([
    ['provider_error', 'The model provider request failed'],
    ['step_limit', 'The model reached its step limit'],
    ['token_limit', 'The model reached its output token limit'],
    ['aborted', 'The response was stopped'],
    ['no_model', 'No model is selected'],
    ['process_interrupted', 'The app was closed during the response']
  ] as const)(
    'user reads a named heading when the failure is %s, then the detail and retry remain',
    (failureCode, heading) => {
      renderMessageList({
        errorMessage: 'Offline.',
        failureCode,
        onRetry: () => undefined
      })

      const outcome = screen.getByRole('alert')
      expect(outcome).toHaveTextContent(heading)
      expect(outcome).toHaveTextContent('Offline.')
      expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
    }
  )
})
