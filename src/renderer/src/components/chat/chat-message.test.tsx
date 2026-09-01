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

  it('renders a streamed answer without per-word wrappers', () => {
    render(
      <ChatMessage
        isStreaming
        message={{
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'The answer appears immediately.' }]
        }}
      />
    )

    expect(screen.getByTestId('answer-content')).toHaveTextContent(
      'The answer appears immediately.'
    )
    expect(
      screen.getByTestId('answer-content').querySelectorAll('.chat-message__stream-word')
    ).toHaveLength(0)
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
