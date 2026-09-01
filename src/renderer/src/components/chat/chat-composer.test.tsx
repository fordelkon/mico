import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
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
