import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ChatMessageList } from './chat-message-list'

describe('ChatMessageList', () => {
  it('shows a provider error as an alert', () => {
    render(
      <ChatMessageList
        conversationId="conversation-1"
        errorMessage="The chat provider could not complete the response."
        isResponding={false}
        messages={[]}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The chat provider could not complete the response.'
    )
  })
})
