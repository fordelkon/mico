import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@mico/ui'
import { FileTextIcon, PlusIcon, XIcon } from 'lucide-react'
import * as React from 'react'

import { CodeDocumentsMaxTextBytes, type ChatDocumentPart } from '@shared/data/schemas/chat'

type ComposerAttachmentProps = {
  disabled?: boolean
  documents: ChatDocumentPart[]
  onDocumentsChange: (documents: ChatDocumentPart[]) => void
}

const textEncoder = new TextEncoder()

function ComposerAttachmentList({
  disabled = false,
  documents,
  onDocumentsChange
}: ComposerAttachmentProps): React.JSX.Element | null {
  if (!documents.length) return null

  return (
    <AttachmentGroup aria-label="Attached documents">
      {documents.map((document, index) => {
        const bytes = textEncoder.encode(document.text).byteLength

        return (
          <Attachment key={`${document.name}-${index}`} size="sm" className="max-w-72">
            <AttachmentMedia>
              <FileTextIcon aria-hidden="true" />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle title={document.name}>{document.name}</AttachmentTitle>
              <AttachmentDescription>
                {bytes.toLocaleString('en-US')} {bytes === 1 ? 'byte' : 'bytes'}
              </AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions>
              <AttachmentAction
                aria-label={`Remove ${document.name}`}
                disabled={disabled}
                onClick={() =>
                  onDocumentsChange(documents.filter((candidate) => candidate !== document))
                }
                type="button"
              >
                <XIcon aria-hidden="true" />
              </AttachmentAction>
            </AttachmentActions>
          </Attachment>
        )
      })}
    </AttachmentGroup>
  )
}

function ComposerAttachments({
  disabled = false,
  documents,
  onDocumentsChange
}: ComposerAttachmentProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const [picking, setPicking] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const documentsRef = React.useRef(documents)

  React.useLayoutEffect(() => {
    documentsRef.current = documents
  }, [documents])

  const pickDocuments = async (): Promise<void> => {
    setPicking(true)
    try {
      const picked = await window.api.attachments.pickCodeDocuments()
      if (!picked.length) return

      const next = [...documentsRef.current, ...picked]
      const bytes = next.reduce(
        (total, document) => total + textEncoder.encode(document.text).byteLength,
        0
      )
      if (bytes > CodeDocumentsMaxTextBytes) {
        setError(
          'Cannot attach these files: the total exceeds 1 MiB. Remove an attachment or choose smaller files.'
        )
        return
      }
      onDocumentsChange(next)
      setError(null)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not attach files. Try selecting the code or text files again.'
      )
    } finally {
      setPicking(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={open ? 'Close attachment menu' : 'Add attachment'}
            disabled={disabled || picking}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <PlusIcon
              aria-hidden="true"
              className={`transition-transform duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none${open ? ' rotate-45' : ''}`}
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-fit min-w-36 duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:animate-none"
          side="top"
        >
          <DropdownMenuItem onSelect={() => void pickDocuments()}>
            <FileTextIcon aria-hidden="true" />
            Attach files
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? (
        <p className="max-w-64 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export { ComposerAttachmentList, ComposerAttachments }
