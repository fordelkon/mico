import { deleteTextareaRange, insertTextareaText } from '../composer-edit-commands'
import { shouldCapturePastedText } from '../composer-paste-capture-policy'
import {
  createPasteToken,
  pasteClipboardText,
  reconcilePasteTokens,
  restorePasteToken
} from '../composer-paste-tokens'
import type { ChatComposerDraft } from './composer-draft-types'

type DraftAccess = {
  get: () => ChatComposerDraft
  update: (change: (draft: ChatComposerDraft) => ChatComposerDraft) => void
}

type ClipboardInput = {
  clipboardData: Pick<DataTransfer, 'getData' | 'setData'>
  preventDefault: () => void
  currentTarget: HTMLTextAreaElement
}

type ComposerDraftEditor = {
  observe: (text: string) => void
  paste: (event: ClipboardInput) => void
  copy: (event: ClipboardInput) => void
  cut: (event: ClipboardInput) => void
  repair: (textarea: HTMLTextAreaElement | null) => void
}

/** Native input observation owns text updates; edit commands never manufacture undo history. */
function createComposerDraftEditor({ get, update }: DraftAccess): ComposerDraftEditor {
  const edit = (
    textarea: HTMLTextAreaElement,
    start: number,
    end: number,
    apply: () => void,
    refused: () => void
  ): void => {
    const before = textarea.value
    textarea.focus()
    textarea.setSelectionRange(start, end)
    apply()
    if (textarea.value === before) refused()
  }
  const error = (sendError: string): void => update((current) => ({ ...current, sendError }))

  return {
    observe(text: string): void {
      update((current) => ({
        ...current,
        text,
        sendError: null,
        pasteTokens: reconcilePasteTokens(current.text, text, current.pasteTokens)
      }))
    },
    paste(event: ClipboardInput): void {
      const clipboard = event.clipboardData
      const textarea = event.currentTarget
      const text = clipboard.getData('text/plain') || clipboard.getData('text')
      if (!shouldCapturePastedText(text)) return
      const start = textarea.selectionStart ?? textarea.value.length
      const end = textarea.selectionEnd ?? start
      const token = createPasteToken(text, get().pasteTokens, start)
      event.preventDefault()
      // Publish metadata before the native transaction dispatches its input event.
      update((current) => ({ ...current, pasteTokens: [...current.pasteTokens, token] }))
      edit(
        textarea,
        start,
        end,
        () => insertTextareaText(token.displayText),
        () => {
          update((current) => ({
            ...current,
            pasteTokens: current.pasteTokens.filter((entry) => entry.id !== token.id),
            sendError:
              'Could not collapse this paste in the editor. Try pasting again, or attach the text as a file.'
          }))
        }
      )
    },
    copy(event: ClipboardInput): void {
      const clipboard = event.clipboardData
      const textarea = event.currentTarget
      const expanded = pasteClipboardText(
        textarea.value,
        get().pasteTokens,
        textarea.selectionStart ?? 0,
        textarea.selectionEnd ?? 0
      )
      if (expanded === null) return
      clipboard.setData('text/plain', expanded)
      event.preventDefault()
    },
    cut(event: ClipboardInput): void {
      const clipboard = event.clipboardData
      const textarea = event.currentTarget
      const start = textarea.selectionStart ?? 0
      const end = textarea.selectionEnd ?? 0
      const expanded = pasteClipboardText(textarea.value, get().pasteTokens, start, end)
      if (expanded === null) return
      clipboard.setData('text/plain', expanded)
      event.preventDefault()
      edit(
        textarea,
        start,
        end,
        () => deleteTextareaRange(textarea, start, end),
        () => {
          error(
            'The pasted text was copied, but the editor could not cut it. Your draft is kept. Try cutting again or delete the selected text.'
          )
        }
      )
    },
    repair(textarea: HTMLTextAreaElement | null): void {
      const draft = get()
      const damaged = draft.pasteTokens.find((token) => token.state === 'damaged')
      if (!textarea || !damaged) return
      const range = restorePasteToken(draft.text, damaged)
      if (!range) return
      edit(
        textarea,
        range.start,
        range.end,
        () => insertTextareaText(damaged.displayText),
        () => {
          error(
            'Could not restore the pasted text in the editor. Undo your edit (Ctrl+Z) or delete the token and paste the text again.'
          )
        }
      )
    }
  }
}

export { createComposerDraftEditor }
