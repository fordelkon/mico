import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatDocumentPart } from '@shared/data/schemas/chat'
import { chatComposerDrafts, composerDraftKey, useChatComposerDraft } from './composer-drafts'

const key = composerDraftKey('in-flight-draft')

afterEach(() => chatComposerDrafts.clearDraft(key))

describe('composer draft acceptance', () => {
  it('user edits the same draft during a send when it is accepted, then the new text stays', async () => {
    const { result } = renderHook(() => useChatComposerDraft(key))
    act(() => result.current[1].observe('submitted text'))
    const send = Promise.withResolvers<boolean>()
    const onSend = vi
      .fn<(content: { text: string; documents: ChatDocumentPart[] }) => Promise<boolean>>()
      .mockReturnValue(send.promise)
    let sending!: Promise<void>
    act(() => {
      sending = result.current[1].submit({
        canSend: true,
        hasSelectedModel: true,
        onSend,
        resolveInvocation: () => undefined
      })
    })
    act(() => result.current[1].observe('follow-up text'))
    await act(async () => {
      send.resolve(true)
      await sending
    })
    expect(onSend).toHaveBeenCalledWith({ text: 'submitted text', documents: [] })
    expect(result.current[0].text).toBe('follow-up text')
    expect(result.current[0].isSending).toBe(false)
  })

  it('user replaces attachments during a send when their content is equal, then the newer selection stays', async () => {
    const { result } = renderHook(() => useChatComposerDraft(key))
    const document: ChatDocumentPart = { type: 'document', name: 'note.txt', text: 'original' }
    act(() => result.current[1].setDocuments([document]))
    const send = Promise.withResolvers<boolean>()
    let sending!: Promise<void>
    act(() => {
      sending = result.current[1].submit({
        canSend: true,
        hasSelectedModel: true,
        onSend: () => send.promise,
        resolveInvocation: () => undefined
      })
    })
    act(() => result.current[1].setDocuments([{ ...document }]))
    await act(async () => {
      send.resolve(true)
      await sending
    })
    expect(result.current[0].documents).toEqual([document])
    expect(result.current[0].isSending).toBe(false)
  })
})
