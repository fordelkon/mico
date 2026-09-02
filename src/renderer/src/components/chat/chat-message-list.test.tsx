import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ChatMessageList } from './chat-message-list'

describe('ChatMessageList', () => {
  it('keeps the pending thinking state until an assistant response has content', () => {
    const userMessage = {
      id: 'user-1',
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: 'What should I work on next?' }]
    }
    const { rerender } = render(
      <ChatMessageList conversationId="conversation-1" isResponding messages={[userMessage]} />
    )
    const pendingThinking = document.querySelector('[data-message-id="pending-assistant"]')

    rerender(
      <ChatMessageList
        conversationId="conversation-1"
        isResponding
        messages={[userMessage, { id: 'assistant-1', role: 'assistant', parts: [] }]}
      />
    )

    expect(document.querySelector('[data-message-id="pending-assistant"]')).toBe(pendingThinking)

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

    expect(document.querySelector('[data-message-id="pending-assistant"]')).toBeNull()
    expect(screen.getAllByTestId('answer-content').at(-1)).toHaveTextContent(
      'Start with the most important task.'
    )
  })

  it('does not make sent user messages scroll anchors', () => {
    render(
      <ChatMessageList
        conversationId="conversation-1"
        isResponding={false}
        messages={[
          {
            id: 'user-1',
            role: 'user',
            parts: [{ type: 'text', text: 'Keep this message near the latest content.' }]
          }
        ]}
      />
    )

    expect(
      screen.getByText('Keep this message near the latest content.').closest('[data-message-id]')
    ).not.toHaveAttribute('data-scroll-anchor', 'true')
  })

  it('shows a provider error as an alert', () => {
    const onRetry = vi.fn()
    render(
      <ChatMessageList
        conversationId="conversation-1"
        errorMessage="The chat provider could not complete the response."
        isResponding={false}
        messages={[]}
        onRetry={onRetry}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The chat provider could not complete the response.'
    )
  })

  it('retries a failed response when requested', async () => {
    const onRetry = vi.fn()
    const user = userEvent.setup()
    render(
      <ChatMessageList
        conversationId="conversation-1"
        errorMessage="The chat provider could not complete the response."
        isResponding={false}
        messages={[]}
        onRetry={onRetry}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('marks the jump-to-latest control while a response is streaming', () => {
    render(<ChatMessageList conversationId="conversation-1" isResponding messages={[]} />)

    expect(screen.getByRole('button', { name: 'Scroll to end' })).toHaveAttribute(
      'data-streaming',
      'true'
    )
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

    expect(screen.getByTestId('retry-progress')).toHaveStyle('--retry-delay: 2000ms')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Connection interrupted. Retrying in 2s · attempt 2 of 5.'
    )
  })
})
