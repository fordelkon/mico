import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ChatComposer } from './chat-composer'

const props = {
  focusKey: 0,
  mode: 'send' as const,
  onSend: vi.fn(),
  onStop: vi.fn(),
  reasoningCapabilities: null,
  thinkingEffort: 'medium' as const,
  onThinkingEffortChange: vi.fn()
}

describe('ChatComposer', () => {
  it('expands to fit a draft and returns to its single-line height after sending', async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()
    render(<ChatComposer {...props} onSend={onSend} />)

    // SAFETY: ChatComposer renders this unique placeholder on its textarea control.
    const textarea = screen.getByPlaceholderText('Message Mico Today') as HTMLTextAreaElement
    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      get: () => (textarea.value ? 96 : 56)
    })

    fireEvent.change(textarea, { target: { value: 'A multi-line draft.' } })

    expect(textarea).toHaveStyle({ height: '96px' })

    await user.click(screen.getByRole('button', { name: 'Send message' }))

    expect(onSend).toHaveBeenCalledWith('A multi-line draft.')
    expect(textarea).toHaveStyle({ height: '56px' })
  })

  it('swaps the send icon for stop without replacing the control', () => {
    const { rerender } = render(<ChatComposer {...props} />)
    const sendButton = screen.getByRole('button', { name: 'Send message' })

    rerender(<ChatComposer {...props} mode="stop" />)

    const stopButton = screen.getByRole('button', { name: 'Stop response' })
    expect(stopButton).toBe(sendButton)
    expect(stopButton.querySelector('[data-slot="icon-swap"]')).toHaveAttribute('data-state', 'to')
  })

  it('does not render a thinking menu without adjustable capabilities', () => {
    render(<ChatComposer {...props} />)

    expect(screen.queryByRole('button', { name: 'Thinking effort' })).toBeNull()
  })

  it('renders only advertised options and commits the selected option', async () => {
    const user = userEvent.setup()
    render(
      <ChatComposer
        {...props}
        reasoningCapabilities={{
          selectableEfforts: ['none', 'low', 'high'],
          defaultEffort: 'low'
        }}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Thinking effort' }))

    expect(screen.queryByRole('menuitemradio', { name: 'Default' })).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: 'Off' })).toBeVisible()
    expect(screen.queryByRole('menuitemradio', { name: 'Medium' })).toBeNull()

    await user.click(screen.getByRole('menuitemradio', { name: 'High' }))

    expect(props.onThinkingEffortChange).toHaveBeenCalledWith('high')
  })

  it.each(['stop', 'disabled'] as const)(
    'disables the thinking menu while composer mode is %s',
    (mode) => {
      render(
        <ChatComposer
          {...props}
          mode={mode}
          reasoningCapabilities={{
            selectableEfforts: ['none', 'medium'],
            defaultEffort: 'medium'
          }}
        />
      )

      expect(screen.getByRole('button', { name: 'Thinking effort' })).toBeDisabled()
    }
  )
})
