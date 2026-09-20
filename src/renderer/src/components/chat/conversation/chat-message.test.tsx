import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatMessage } from './chat-message'

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ChatMessage', () => {
  it.each(['', 'Review these files'])(
    'shows persisted document names and UTF-8 sizes alongside text %j',
    async (text) => {
      const user = userEvent.setup()
      const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
      render(
        <ChatMessage
          isStreaming={false}
          message={{
            id: 'persisted-user',
            role: 'user',
            parts: [
              ...(text ? [{ type: 'text' as const, text }] : []),
              {
                type: 'data-document',
                data: { type: 'document', name: 'example.ts', text: '你好' }
              },
              { type: 'data-document', data: { type: 'document', name: 'notes.md', text: 'x' } }
            ]
          }}
        />
      )

      expect(screen.getByText('example.ts')).toBeVisible()
      expect(screen.getByText('6 bytes')).toBeVisible()
      expect(screen.getByText('notes.md')).toBeVisible()
      expect(screen.getByText('1 byte')).toBeVisible()
      if (text) expect(screen.getByTestId('answer-content')).toHaveTextContent(text)
      await user.click(screen.getByRole('button', { name: 'Copy message' }))
      expect(writeText).toHaveBeenCalledWith(
        `${text ? `${text}\n\n` : ''}Attached document: example.ts (6 bytes)\nAttached document: notes.md (1 byte)`
      )
    }
  )

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

    expect(screen.getByRole('button', { name: 'Agent run' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(screen.getByTestId('thinking-panel').firstElementChild).toHaveAttribute(
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

    expect(screen.getByRole('button', { name: 'Agent run' })).toBeVisible()
    expect(screen.getByTestId('thinking-panel').firstElementChild).toHaveAttribute(
      'aria-hidden',
      'true'
    )
    expect(screen.getByTestId('answer-content')).toHaveTextContent('The answer.')
    expect(screen.getByTestId('answer-content')).not.toHaveTextContent('Inspecting the request.')
  })

  it('keeps tool traces between consecutive reasoning parts', () => {
    render(
      <ChatMessage
        isStreaming={false}
        message={{
          id: 'assistant-tools',
          role: 'assistant',
          parts: [
            { type: 'reasoning', text: 'Inspecting the request.' },
            {
              type: 'dynamic-tool',
              toolCallId: 'call-1',
              toolName: 'read',
              state: 'output-available',
              input: { path: 'src/index.ts' },
              output: 'export {}'
            },
            { type: 'reasoning', text: 'Preparing the answer.' },
            { type: 'text', text: 'Done.' }
          ]
        }}
      />
    )

    const transcript = screen.getByText('Done.').closest('[data-slot="message-content"]')
    if (!transcript) throw new Error('Message content is missing.')
    expect(transcript.textContent).toMatch(
      /Inspecting the request\.[\s\S]*Read[\s\S]*src\/index\.ts[\s\S]*Preparing the answer\.[\s\S]*Done\./
    )
  })

  it('keeps an interim model update as body copy and starts the following activity in a new step', () => {
    render(
      <ChatMessage
        isStreaming={false}
        message={{
          id: 'assistant-stage-output',
          role: 'assistant',
          parts: [
            { type: 'reasoning', text: 'Inspecting the request.' },
            { type: 'text', text: 'I found the relevant component.' },
            {
              type: 'dynamic-tool',
              toolCallId: 'call-stage-output',
              toolName: 'read',
              state: 'output-available',
              input: { path: 'src/index.ts' },
              output: 'export {}'
            },
            { type: 'text', text: 'Done.' }
          ]
        }}
      />
    )

    const activities = screen.getAllByTestId('agent-activity-event')
    expect(activities).toHaveLength(2)
    expect(activities[0]).toHaveTextContent('Inspecting the request.')
    expect(activities[0]).not.toHaveTextContent('I found the relevant component.')
    expect(activities[1]).toHaveTextContent('Read')
    // The interim update renders as body copy between the two model steps.
    const transcript = screen.getByText('Done.').closest('[data-slot="message-content"]')
    if (!transcript) throw new Error('Message content is missing.')
    expect(transcript.textContent).toMatch(
      /Inspecting the request\.[\s\S]*I found the relevant component\.[\s\S]*Read[\s\S]*Done\./
    )
    expect(screen.getAllByTestId('answer-content').at(-1)).toHaveTextContent('Done.')
  })

  it('compacts a completed tool when the next reasoning activity arrives', () => {
    const tool = {
      type: 'dynamic-tool' as const,
      toolCallId: 'call-sequence',
      toolName: 'bash',
      input: { command: 'printf sequence' }
    }
    const { rerender } = render(
      <ChatMessage
        isStreaming
        message={{
          id: 'assistant-sequence',
          role: 'assistant',
          parts: [{ ...tool, state: 'input-available' }]
        }}
      />
    )

    rerender(
      <ChatMessage
        isStreaming
        message={{
          id: 'assistant-sequence',
          role: 'assistant',
          parts: [
            { ...tool, state: 'output-available', output: 'sequence' },
            { type: 'reasoning', text: 'Checking the next step.' }
          ]
        }}
      />
    )

    expect(screen.getByRole('button', { name: 'Run printf sequence Completed' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(screen.getAllByTestId('agent-activity-event')).toHaveLength(1)
  })
})
