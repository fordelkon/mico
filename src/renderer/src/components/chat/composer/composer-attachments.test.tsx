import '@testing-library/jest-dom/vitest'

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatDocumentPart } from '@shared/data/schemas/chat'

import { ComposerAttachmentList, ComposerAttachments } from './composer-attachments'

const pickCodeDocuments = vi.fn<() => Promise<ChatDocumentPart[]>>()

beforeEach(() => {
  pickCodeDocuments.mockReset().mockResolvedValue([])
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { attachments: { pickCodeDocuments } }
  })
})

function AttachmentHarness({ initial = [] }: { initial?: ChatDocumentPart[] }): React.JSX.Element {
  const [documents, setDocuments] = React.useState(initial)
  return (
    <>
      <ComposerAttachmentList documents={documents} onDocumentsChange={setDocuments} />
      <ComposerAttachments documents={documents} onDocumentsChange={setDocuments} />
    </>
  )
}

async function attachFiles(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Add attachment' }))
  await user.click(screen.getByRole('menuitem', { name: 'Attach files' }))
}

describe('ComposerAttachments', () => {
  it('shows selected file names and UTF-8 byte sizes', async () => {
    const user = userEvent.setup()
    pickCodeDocuments.mockResolvedValue([{ type: 'document', name: 'index.ts', text: '你好' }])
    render(<AttachmentHarness />)

    await attachFiles(user)

    expect(await screen.findByText('index.ts')).toBeVisible()
    expect(screen.getByText('6 bytes')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Remove index.ts' })).toBeVisible()
  })

  it('removes only the selected document when file names are identical', async () => {
    const user = userEvent.setup()
    render(
      <AttachmentHarness
        initial={[
          { type: 'document', name: 'index.ts', text: 'a' },
          { type: 'document', name: 'index.ts', text: 'different' }
        ]}
      />
    )

    await user.click(screen.getAllByRole('button', { name: 'Remove index.ts' })[0])

    expect(screen.getAllByText('index.ts')).toHaveLength(1)
    expect(screen.getByText('9 bytes')).toBeVisible()
    expect(screen.queryByText('1 byte')).toBeNull()
  })

  it('keeps existing attachments when the native picker is cancelled', async () => {
    const user = userEvent.setup()
    render(<AttachmentHarness initial={[{ type: 'document', name: 'keep.txt', text: 'keep' }]} />)

    await attachFiles(user)

    expect(screen.getByText('keep.txt')).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the actionable picker error and allows another selection', async () => {
    const user = userEvent.setup()
    pickCodeDocuments.mockRejectedValueOnce(
      new Error('Cannot attach image.png: unsupported file type. Choose a code or text file.')
    )
    render(<AttachmentHarness />)

    await attachFiles(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cannot attach image.png: unsupported file type. Choose a code or text file.'
    )
    pickCodeDocuments.mockResolvedValueOnce([{ type: 'document', name: 'valid.txt', text: 'ok' }])
    await attachFiles(user)
    expect(await screen.findByText('valid.txt')).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('rejects a new batch that exceeds the combined turn byte limit', async () => {
    const user = userEvent.setup()
    render(
      <AttachmentHarness
        initial={Array.from({ length: 4 }, (_, index) => ({
          type: 'document',
          name: `${index}.txt`,
          text: 'a'.repeat(256 * 1024)
        }))}
      />
    )
    pickCodeDocuments.mockResolvedValue([{ type: 'document', name: 'extra.txt', text: 'a' }])

    await attachFiles(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(/1 MiB/)
    expect(screen.queryByText('extra.txt')).toBeNull()
    expect(screen.getByText('0.txt')).toBeVisible()
  })

  it('prevents opening another picker while a selection is pending', async () => {
    const user = userEvent.setup()
    let resolvePicker: (documents: ChatDocumentPart[]) => void = () => undefined
    pickCodeDocuments.mockReturnValue(
      new Promise((resolve) => {
        resolvePicker = resolve
      })
    )
    render(<AttachmentHarness />)

    await attachFiles(user)
    expect(screen.getByRole('button', { name: 'Add attachment' })).toBeDisabled()
    resolvePicker([])
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add attachment' })).toBeEnabled()
    )
  })

  it('does not restore a removed attachment when a pending picker completes', async () => {
    const user = userEvent.setup()
    let resolvePicker: (documents: ChatDocumentPart[]) => void = () => undefined
    pickCodeDocuments.mockReturnValue(
      new Promise((resolve) => {
        resolvePicker = resolve
      })
    )
    render(<AttachmentHarness initial={[{ type: 'document', name: 'old.txt', text: 'old' }]} />)

    await attachFiles(user)
    await user.click(screen.getByRole('button', { name: 'Remove old.txt' }))
    resolvePicker([{ type: 'document', name: 'new.txt', text: 'new' }])

    expect(await screen.findByText('new.txt')).toBeVisible()
    expect(screen.queryByText('old.txt')).toBeNull()
  })
})
