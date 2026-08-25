import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ArrowDownIcon, FileTextIcon } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'

import { Attachment, AttachmentAction, AttachmentTrigger } from '../attachment'
import { Bubble, BubbleContent } from '../bubble'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../empty'
import { Marker, MarkerContent, MarkerIcon } from '../marker'
import { Message } from '../message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '../message-scroller'
import { Textarea } from '../textarea'

describe('chat primitives', () => {
  it('exposes message alignment for layout styling', () => {
    render(<Message align="end">Hello</Message>)

    expect(screen.getByText('Hello')).toHaveAttribute('data-align', 'end')
  })

  it('preserves link semantics when bubble content delegates to a child', () => {
    render(
      <Bubble variant="outline">
        <BubbleContent asChild>
          <a href="https://example.com/source">Open source</a>
        </BubbleContent>
      </Bubble>
    )

    expect(screen.getByRole('link', { name: 'Open source' })).toHaveAttribute(
      'href',
      'https://example.com/source'
    )
  })

  it('does not submit a form when its attachment trigger is activated', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())

    render(
      <form onSubmit={onSubmit}>
        <Attachment>
          <AttachmentTrigger aria-label="Open attachment" />
        </Attachment>
      </form>
    )
    await user.click(screen.getByRole('button', { name: 'Open attachment' }))

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('exposes an accessible attachment action', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()

    render(
      <Attachment>
        <AttachmentAction aria-label="Remove report.pdf" onClick={onRemove}>
          <FileTextIcon />
        </AttachmentAction>
      </Attachment>
    )
    await user.click(screen.getByRole('button', { name: 'Remove report.pdf' }))

    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('preserves native textarea state and the public data slot', () => {
    render(
      <Textarea
        aria-invalid="true"
        aria-label="Message"
        className="min-h-32"
        defaultValue="Draft"
        disabled
      />
    )

    const textarea = screen.getByRole('textbox', { name: 'Message' })

    expect(textarea).toBeDisabled()
    expect(textarea).toHaveAttribute('aria-invalid', 'true')
    expect(textarea).toHaveAttribute('data-slot', 'textarea')
    expect(textarea).toHaveClass('min-h-32')
    expect(textarea).toHaveValue('Draft')
  })

  it('composes a chat empty state with structured content', () => {
    render(
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">M</EmptyMedia>
          <EmptyTitle>Start a conversation</EmptyTitle>
          <EmptyDescription>Message Mico when you are ready.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )

    const title = screen.getByText('Start a conversation')
    const description = screen.getByText('Message Mico when you are ready.')

    expect(title).toHaveAttribute('data-slot', 'empty-title')
    expect(description).toHaveAttribute('data-slot', 'empty-description')
    expect(title.closest('[data-slot="empty"]')).toBeInTheDocument()
    expect(screen.getByText('M')).toHaveAttribute('data-variant', 'icon')
  })

  it('hides decorative marker icons while preserving delegated link semantics', () => {
    render(
      <Marker asChild variant="separator">
        <a href="#unread">
          <MarkerIcon data-testid="marker-icon">
            <ArrowDownIcon />
          </MarkerIcon>
          <MarkerContent>Unread messages</MarkerContent>
        </a>
      </Marker>
    )

    expect(screen.getByRole('link', { name: 'Unread messages' })).toHaveAttribute('href', '#unread')
    expect(screen.getByTestId('marker-icon')).toHaveAttribute('aria-hidden', 'true')
  })

  it.each([
    ['end', 'Scroll to end'],
    ['start', 'Scroll to start']
  ] as const)('labels the %s message scroller control', (direction, accessibleName) => {
    render(
      <MessageScrollerProvider>
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent />
          </MessageScrollerViewport>
          <MessageScrollerButton direction={direction} />
        </MessageScroller>
      </MessageScrollerProvider>
    )

    expect(screen.getByRole('button', { name: accessibleName })).toBeInTheDocument()
  })
})
