import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import * as React from 'react'

import { ChatComposer } from './chat-composer'

const props = {
  focusKey: 0,
  mode: 'send' as const,
  onSend: (): void => undefined,
  onStop: (): void => undefined,
  hasSelectedModel: true,
  modelSelector: null,
  reasoningCapabilities: null,
  thinkingEffort: 'medium' as const,
  onThinkingEffortChange: (): void => undefined
}

function ComposerHarness({ mode = 'send' }: { mode?: 'send' | 'stop' }): React.JSX.Element {
  const [sentContent, setSentContent] = React.useState('')
  const [wasStopped, setWasStopped] = React.useState(false)

  return (
    <>
      <ChatComposer
        {...props}
        mode={mode}
        onSend={setSentContent}
        onStop={() => setWasStopped(true)}
      />
      {sentContent && <output>{sentContent}</output>}
      {wasStopped && <output>Response stopped</output>}
    </>
  )
}

function ThinkingEffortHarness(): React.JSX.Element {
  const [selection, setSelection] = React.useState('')

  return (
    <>
      <ChatComposer
        {...props}
        reasoningCapabilities={{
          selectableEfforts: ['none', 'low', 'high'],
          defaultEffort: 'low'
        }}
        onThinkingEffortChange={setSelection}
      />
      {selection && <output>{`Thinking effort: ${selection}`}</output>}
    </>
  )
}

describe('ChatComposer', () => {
  it('clears a sent draft and restores its single-line height', async () => {
    const user = userEvent.setup()
    render(<ComposerHarness />)

    // SAFETY: ChatComposer renders this unique placeholder on its textarea control.
    const textarea = screen.getByPlaceholderText('Message Mico Today') as HTMLTextAreaElement
    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      get: () => (textarea.value ? 96 : 56)
    })

    fireEvent.change(textarea, { target: { value: 'A multi-line draft.' } })

    expect(textarea).toHaveStyle({ height: '96px' })

    await user.click(screen.getByRole('button', { name: 'Send message' }))

    expect(screen.getByText('A multi-line draft.')).toBeVisible()
    expect(textarea).toHaveStyle({ height: '56px' })
  })

  it('lets a user stop an in-progress response', async () => {
    const user = userEvent.setup()
    render(<ComposerHarness mode="stop" />)

    await user.click(screen.getByRole('button', { name: 'Stop response' }))

    expect(screen.getByText('Response stopped')).toBeVisible()
  })

  it('prevents sending a drafted message until an enabled model is selected', async () => {
    const user = userEvent.setup()
    render(<ChatComposer {...props} hasSelectedModel={false} />)

    await user.type(screen.getByRole('textbox'), 'Hello')

    expect(
      screen.getByRole('button', { name: 'Select an enabled model to send messages' })
    ).toBeDisabled()
  })

  it('does not render a thinking menu without adjustable capabilities', () => {
    render(<ChatComposer {...props} />)

    expect(screen.queryByRole('button', { name: 'Thinking effort' })).toBeNull()
  })

  it('renders only advertised options and commits the selected option', async () => {
    const user = userEvent.setup()
    render(<ThinkingEffortHarness />)

    await user.click(screen.getByRole('button', { name: 'Thinking effort' }))

    expect(screen.queryByRole('menuitemradio', { name: 'Default' })).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: 'Off' })).toBeVisible()
    expect(screen.queryByRole('menuitemradio', { name: 'Medium' })).toBeNull()

    await user.click(screen.getByRole('menuitemradio', { name: 'High' }))

    expect(screen.getByText('Thinking effort: high')).toBeVisible()
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
