import type { ChatDocumentPart } from '@shared/data/schemas/chat'

type ComposerToken = {
  start: number
  end: number
  kind: 'command' | 'skill' | 'paste'
}

/** Exact visible labels identify captured payloads across native undo and redo. */
type ComposerPasteToken = {
  id: string
  text: string
  displayText: string
  start: number
  end: number
  state: 'active' | 'retired' | 'damaged'
  /** Broken variants remain recoverable when a repair is undone. */
  damagedTexts: string[]
}

/** Renderer memory retained across navigation for this application run. */
type ChatComposerDraft = {
  text: string
  documents: ChatDocumentPart[]
  pasteTokens: ComposerPasteToken[]
  isSending: boolean
  sendError: string | null
}

export type { ChatComposerDraft, ComposerPasteToken, ComposerToken }
