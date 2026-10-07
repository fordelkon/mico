import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MicoUIMessage } from '@renderer/types/chat'

import { ChatMessage } from './chat-message'

beforeEach(() => {
  // SAFETY: jsdom cannot create a canvas 2D context; the stub keeps canvas-backed rendering from throwing.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function renderAssistantMessage(
  parts: MicoUIMessage['parts'],
  { isStreaming = false, id = 'assistant-1' }: { id?: string; isStreaming?: boolean } = {}
): RenderResult {
  return render(
    <ChatMessage isStreaming={isStreaming} message={{ id, role: 'assistant', parts }} />
  )
}

describe('ChatMessage', () => {
  it('user reads tool output when the message rerenders, then earlier output is not appended twice', async () => {
    const user = userEvent.setup()
    const message: MicoUIMessage = {
      id: 'streamed-output',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolCallId: 'shell',
          toolName: 'Bash',
          state: 'input-available',
          input: { command: 'echo first' }
        },
        {
          type: 'data-tool-output-delta',
          data: { toolCallId: 'shell', toolName: 'Bash', stream: 'stdout', delta: 'first\n' }
        }
      ]
    }
    const { rerender } = render(<ChatMessage message={message} isStreaming />)
    await user.click(screen.getByRole('button', { name: /Bash echo first/ }))
    rerender(<ChatMessage message={{ ...message }} isStreaming />)
    const output = screen.getByRole('log', { name: 'Terminal output' })
    expect(output.textContent?.match(/first/g)).toHaveLength(1)
  })
  it.each(['', 'Review these files'])(
    'user sees document names and sizes with text %j when rendering, then copying includes them',
    async (text) => {
      const user = userEvent.setup()
      // SAFETY: jsdom exposes no real clipboard; the spy is the seam for asserting what the user copies.
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
      expect(screen.queryByTestId('answer-content')?.textContent ?? '').toContain(text)
      await user.click(screen.getByRole('button', { name: 'Copy message' }))
      expect(writeText).toHaveBeenCalledWith(
        `${text ? `${text}\n\n` : ''}Attached document: example.ts (6 bytes)\nAttached document: notes.md (1 byte)`
      )
    }
  )

  it('user sees unfinished code readable when highlighting has not finished, then lines show', () => {
    renderAssistantMessage([{ type: 'text', text: '```ts\nconst answer = 42' }], {
      isStreaming: true
    })

    expect(screen.getByTestId('code-block')).toHaveTextContent('const answer = 42')
    expect(screen.getByTestId('code-block')).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeVisible()
  })

  it('user sees completed lines stay highlighted when a tail is appended, then tokens persist', async () => {
    const initialCode = '```ts\nconst answer = 42\nconst pend'
    const { rerender } = renderAssistantMessage([{ type: 'text', text: initialCode }], {
      isStreaming: true
    })

    // SAFETY: jsdom applies no syntax colors; data-code-token is the component's own marker for
    // highlighted token spans and the only handle distinguishing them from the plain-text fallback.
    const hasHighlightedTokens = (): boolean =>
      Array.from(
        screen.getByTestId('code-block').querySelectorAll<HTMLElement>('[data-code-token]')
      ).some((token) => token.textContent === 'const')

    await vi.waitFor(() => {
      expect(hasHighlightedTokens()).toBe(true)
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

    expect(hasHighlightedTokens()).toBe(true)
  })

  it('user sees block math render when the formula closes, then the expression appears', () => {
    renderAssistantMessage([{ type: 'text', text: '$$E = mc^2$$' }])

    expect(screen.getByTestId('answer-content').querySelector('.katex')).toBeInTheDocument()
  })

  it('user sees an unclosed block formula as source when streaming, then it stays literal', () => {
    renderAssistantMessage([{ type: 'text', text: '$$E = mc^2' }], { isStreaming: true })

    expect(screen.getByTestId('answer-content').querySelector('.katex')).toBeNull()
    expect(screen.getByTestId('answer-content')).toHaveTextContent('$$E = mc^2')
  })

  it('user sees currency stay literal when single-dollar math is qualified, then only real math renders', () => {
    renderAssistantMessage([{ type: 'text', text: '$x^2$ costs $5 and uses $HOME' }])

    expect(screen.getByTestId('answer-content').querySelectorAll('.katex')).toHaveLength(1)
    expect(screen.getByTestId('answer-content')).toHaveTextContent('$5')
    expect(screen.getByTestId('answer-content')).toHaveTextContent('$HOME')
  })

  it('user sees raw source for unsupported languages when streaming, then the content stays readable', () => {
    renderAssistantMessage([{ type: 'text', text: '```unknown-language\nplain content\n```' }], {
      isStreaming: true
    })

    expect(screen.getByTestId('code-block')).toHaveTextContent('plain content')
  })

  it('user sees the thought summary collapsed when the answer streams, then it stays hidden', () => {
    renderAssistantMessage(
      [
        { type: 'reasoning', text: 'Comparing the available options.' },
        { type: 'text', text: 'The recommended option is ready.' }
      ],
      { isStreaming: true }
    )

    expect(screen.getByRole('button', { name: 'Thought' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(screen.getByTestId('thinking-panel').firstElementChild).toHaveAttribute(
      'aria-hidden',
      'true'
    )
  })

  it('user sees streamed reasoning separate when the answer arrives, then they do not merge', () => {
    renderAssistantMessage(
      [
        { type: 'reasoning', text: 'Inspecting the request.' },
        { type: 'text', text: 'The answer.' }
      ],
      { isStreaming: true }
    )

    expect(screen.getByRole('button', { name: 'Thought' })).toBeVisible()
    expect(screen.getByTestId('thinking-panel').firstElementChild).toHaveAttribute(
      'aria-hidden',
      'true'
    )
    expect(screen.getByTestId('answer-content')).toHaveTextContent('The answer.')
    expect(screen.getByTestId('answer-content')).not.toHaveTextContent('Inspecting the request.')
  })

  it('user sees tool traces kept between reasoning parts when rendered, then order is preserved', () => {
    renderAssistantMessage(
      [
        { type: 'reasoning', text: 'Inspecting the request.' },
        {
          type: 'dynamic-tool',
          toolCallId: 'call-1',
          toolName: 'Read',
          state: 'output-available',
          input: { path: 'src/index.ts' },
          output: 'export {}'
        },
        { type: 'reasoning', text: 'Preparing the answer.' },
        { type: 'text', text: 'Done.' }
      ],
      { id: 'assistant-tools' }
    )

    const transcript = screen.getByText('Done.').closest('[data-slot="message-content"]')
    if (!transcript) throw new Error('Message content is missing.')
    expect(transcript.textContent).toMatch(
      /Inspecting the request\.[\s\S]*Read[\s\S]*src\/index\.ts[\s\S]*Preparing the answer\.[\s\S]*Done\./
    )
  })

  it('user sees an interim update as body copy when the next step starts, then both render separately', () => {
    renderAssistantMessage(
      [
        { type: 'reasoning', text: 'Inspecting the request.' },
        { type: 'text', text: 'I found the relevant component.' },
        {
          type: 'dynamic-tool',
          toolCallId: 'call-stage-output',
          toolName: 'Read',
          state: 'output-available',
          input: { path: 'src/index.ts' },
          output: 'export {}'
        },
        { type: 'text', text: 'Done.' }
      ],
      { id: 'assistant-stage-output' }
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

  it('user sees one agent run when an empty text block streams mid-step, then the run is not split', () => {
    renderAssistantMessage(
      [
        { type: 'reasoning', text: 'Inspecting the request.', state: 'streaming' },
        { type: 'text', text: '' },
        { type: 'reasoning', text: 'Continuing the inspection.', state: 'streaming' }
      ],
      { isStreaming: true, id: 'assistant-empty-text' }
    )

    expect(screen.getAllByTestId('agent-activity-event')).toHaveLength(1)
  })

  it('user sees a finished thought stay settled when the next step starts, then the trace keeps its compact row', () => {
    const tool = {
      type: 'dynamic-tool' as const,
      toolCallId: 'call-next-step',
      toolName: 'Read',
      input: { path: 'src/index.ts' }
    }
    const { rerender } = renderAssistantMessage(
      [{ type: 'reasoning', text: 'Inspecting the request.', state: 'streaming' }],
      { isStreaming: true, id: 'assistant-interim' }
    )

    expect(screen.getByRole('button', { name: 'Thinking' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )

    rerender(
      <ChatMessage
        isStreaming
        message={{
          id: 'assistant-interim',
          role: 'assistant',
          parts: [
            { type: 'reasoning', text: 'Inspecting the request.', state: 'done' },
            { type: 'text', text: 'I found the relevant component.' },
            { ...tool, state: 'input-available' }
          ]
        }}
      />
    )

    // Finished reasoning keeps its own compact disclosure when the next step starts.
    expect(screen.getByRole('button', { name: 'Thought' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(screen.getAllByRole('status')).toHaveLength(2)

    expect(screen.getByRole('button', { name: 'Thought' })).toBeVisible()
    expect(screen.getByText('Reading file…')).toBeVisible()
    expect(screen.getByText('(src/index.ts)')).toBeVisible()
  })

  it('user sees a completed tool compacted when reasoning follows, then its details collapse', () => {
    const tool = {
      type: 'dynamic-tool' as const,
      toolCallId: 'call-sequence',
      toolName: 'Bash',
      input: { command: 'printf sequence' }
    }
    const { rerender } = renderAssistantMessage([{ ...tool, state: 'input-available' }], {
      isStreaming: true,
      id: 'assistant-sequence'
    })

    rerender(
      <ChatMessage
        isStreaming
        message={{
          id: 'assistant-sequence',
          role: 'assistant',
          parts: [
            { ...tool, state: 'output-available', output: 'sequence' },
            { type: 'reasoning', text: 'Checking the next step.', state: 'streaming' }
          ]
        }}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Bash printf sequence Output available' })
    ).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getAllByTestId('agent-activity-event')).toHaveLength(1)
  })
})
