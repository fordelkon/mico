import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ChatMessage } from './chat-message'

describe('ChatMessage', () => {
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

    expect(screen.getByRole('status', { name: 'Thinking' })).toBeVisible()
    expect(screen.getByText('Inspecting the request.')).toBeVisible()
    expect(screen.getByTestId('answer-content')).toHaveTextContent('The answer.')
    expect(screen.getByTestId('answer-content')).not.toHaveTextContent('Inspecting the request.')
  })
})
