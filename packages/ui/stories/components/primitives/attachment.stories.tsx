import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle
} from '@mico/ui'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { FileTextIcon, XIcon } from 'lucide-react'

const meta = {
  title: 'Components/Primitives/Attachment',
  component: Attachment,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs']
} satisfies Meta<typeof Attachment>

export default meta
type Story = StoryObj<typeof meta>

function FileAttachment({
  state
}: {
  state: 'idle' | 'uploading' | 'processing' | 'error' | 'done'
}) {
  return (
    <Attachment state={state}>
      <AttachmentMedia>
        <FileTextIcon />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>conversation-notes.pdf</AttachmentTitle>
        <AttachmentDescription>
          {state === 'error' ? 'Upload failed' : `PDF · ${state}`}
        </AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
        <AttachmentAction aria-label="Remove conversation-notes.pdf">
          <XIcon />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  )
}

export const States: Story = {
  render: () => (
    <AttachmentGroup className="max-w-[80vw]">
      {(['idle', 'uploading', 'processing', 'error', 'done'] as const).map((state) => (
        <FileAttachment key={state} state={state} />
      ))}
    </AttachmentGroup>
  )
}

export const Vertical: Story = {
  render: () => (
    <Attachment orientation="vertical">
      <AttachmentMedia>
        <FileTextIcon />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>notes.pdf</AttachmentTitle>
        <AttachmentDescription>PDF · 2.4 MB</AttachmentDescription>
      </AttachmentContent>
    </Attachment>
  )
}
