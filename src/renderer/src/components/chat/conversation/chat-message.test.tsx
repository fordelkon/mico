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
  it('keeps an unfinished streamed code fence readable before highlighting finishes', () => {
    render(
      <ChatMessage
        isStreaming
        message={{
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', text: '```ts\nconst answer = 42' }]
        }}
      />
    )

    expect(screen.getByTestId('code-block')).toHaveTextContent('const answer = 42')
    expect(screen.getByTestId('code-block')).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeVisible()
  })

  it('keeps completed lines highlighted while a streamed tail is appended', async () => {
    const initialCode = '```ts\nconst answer = 42\nconst pend'
    const { rerender } = render(
      <ChatMessage
        isStreaming
        message={{
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', text: initialCode }]
        }}
      />
    )

    await vi.waitFor(() => {
      expect(screen.getByTestId('code-block').querySelector('[data-code-token]')).not.toBeNull()
    })

    rerender(
      <ChatMessage
        isStreaming
        message={{
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', text: `${initialCode}ing = 1` }]
        }}
      />
    )

    expect(screen.getByTestId('code-block').querySelector('[data-code-token]')).not.toBeNull()
  })

  it('renders completed block math as a mathematical expression', () => {
    render(
      <ChatMessage
        isStreaming={false}
        message={{
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', text: '$$E = mc^2$$' }]
        }}
      />
    )

    expect(screen.getByTestId('answer-content').querySelector('.katex')).toBeInTheDocument()
  })

  it('keeps an unfinished streamed block formula as source until it closes', () => {
    render(
      <ChatMessage
        isStreaming
        message={{
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', text: '$$E = mc^2' }]
        }}
      />
    )

    expect(screen.getByTestId('answer-content').querySelector('.katex')).toBeNull()
    expect(screen.getByTestId('answer-content')).toHaveTextContent('$$E = mc^2')
  })

  it('renders qualified single-dollar math but leaves currency and shell variables literal', () => {
    render(
      <ChatMessage
        isStreaming={false}
        message={{
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', text: '$x^2$ costs $5 and uses $HOME' }]
        }}
      />
    )

    expect(screen.getByTestId('answer-content').querySelectorAll('.katex')).toHaveLength(1)
    expect(screen.getByTestId('answer-content')).toHaveTextContent('$5')
    expect(screen.getByTestId('answer-content')).toHaveTextContent('$HOME')
  })

  it('keeps an unsupported streamed language readable as raw source', () => {
    render(
      <ChatMessage
        isStreaming
        message={{
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', text: '```unknown-language\nplain content\n```' }]
        }}
      />
    )

    expect(screen.getByTestId('code-block')).toHaveTextContent('plain content')
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
