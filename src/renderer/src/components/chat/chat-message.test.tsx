import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatMessage } from './chat-message'

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ChatMessage', () => {
  it('marks sent user messages for their transcript-entering motion', () => {
    render(
      <ChatMessage
        isStreaming={false}
        message={{
          id: 'user-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Send this thought.' }]
        }}
      />
    )

    expect(screen.getByTestId('answer-content').closest('[data-slot="message"]')).toHaveClass(
      'chat-message--sent'
    )
  })

  it('collapses the thought summary when the answer starts streaming', () => {
    render(
      <ChatMessage
        isStreaming
        message={{
          id: 'assistant-1',
          role: 'assistant',
          parts: [
            { type: 'reasoning', text: 'Comparing the available options.' },
            { type: 'text', text: 'The recommended option is ready.' }
          ]
        }}
      />
    )

    expect(screen.getByRole('button', { name: 'Thought summary' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(screen.getByText('Comparing the available options.')).toHaveAttribute(
      'aria-hidden',
      'true'
    )
  })

  it('renders streamed reasoning separately from the final answer', () => {
    render(
      <ChatMessage
        isStreaming
        message={{
          id: 'assistant-1',
          role: 'assistant',
          parts: [
            { type: 'reasoning', text: 'Inspecting the request.' },
            { type: 'text', text: 'The answer.' }
          ]
        }}
      />
    )

    expect(screen.getByRole('button', { name: 'Thought summary' })).toBeVisible()
    expect(screen.getByText('Inspecting the request.')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('answer-content')).toHaveTextContent('The answer.')
    expect(screen.getByTestId('answer-content')).not.toHaveTextContent('Inspecting the request.')
  })
})
