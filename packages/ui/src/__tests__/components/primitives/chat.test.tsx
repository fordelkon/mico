import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ArrowDownIcon, FileTextIcon } from 'lucide-react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import {
  Attachment,
  AttachmentAction,
  AttachmentTrigger
} from '../../../components/primitives/attachment'
import { Bubble, BubbleContent } from '../../../components/primitives/bubble'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '../../../components/primitives/empty'
import { Marker, MarkerContent, MarkerIcon } from '../../../components/primitives/marker'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '../../../components/primitives/message-scroller'
import { Textarea } from '../../../components/primitives/textarea'

describe('chat primitives', () => {
  it('user opens the bubble link when it uses a child, then the href is preserved', () => {
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

  it('user clicks the attachment trigger when in a form, then nothing submits', async () => {
    const user = userEvent.setup()
    function AttachmentForm() {
      const [submitted, setSubmitted] = useState(false)

      return (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              setSubmitted(true)
            }}
          >
            <Attachment>
              <AttachmentTrigger aria-label="Open attachment" />
            </Attachment>
          </form>
          <output>{submitted ? 'Submitted' : 'Not submitted'}</output>
        </>
      )
    }

    render(<AttachmentForm />)
    await user.click(screen.getByRole('button', { name: 'Open attachment' }))

    expect(screen.getByRole('status')).toHaveTextContent('Not submitted')
  })

  it('user clicks the attachment action when removing a file, then it disappears', async () => {
    const user = userEvent.setup()
    function AttachmentRemoval() {
      const [removed, setRemoved] = useState(false)

      return (
        <>
          <Attachment>
            <AttachmentAction aria-label="Remove report.pdf" onClick={() => setRemoved(true)}>
              <FileTextIcon />
            </AttachmentAction>
          </Attachment>
          <output>{removed ? 'Removed' : 'Attached'}</output>
        </>
      )
    }

    render(<AttachmentRemoval />)
    await user.click(screen.getByRole('button', { name: 'Remove report.pdf' }))

    expect(screen.getByRole('status')).toHaveTextContent('Removed')
  })

  it('user reads the draft when the textarea is disabled and invalid, then it is not editable and shows the draft', () => {
    render(<Textarea aria-invalid="true" aria-label="Message" defaultValue="Draft" disabled />)

    const textarea = screen.getByRole('textbox', { name: 'Message' })

    expect(textarea).toBeDisabled()
    expect(textarea).toBeInvalid()
    expect(textarea).toHaveValue('Draft')
  })

  it('user reads the empty conversation state when it is shown, then its media, title and description are visible', () => {
    render(
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">M</EmptyMedia>
          <EmptyTitle>Start a conversation</EmptyTitle>
          <EmptyDescription>Message Mico when you are ready.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )

    expect(screen.getByText('Start a conversation')).toBeVisible()
    expect(screen.getByText('Message Mico when you are ready.')).toBeVisible()
    expect(screen.getByText('M')).toBeVisible()
  })

  it('user opens the marker link when it uses a child, then icons stay hidden', () => {
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
  ] as const)(
    'user finds the %s scroller control when using the message scroller, then it is reachable by its accessible name',
    (direction, accessibleName) => {
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
    }
  )
})
