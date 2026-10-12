import type { ChatDocumentPart } from '@shared/data/schemas/chat'
import * as React from 'react'

// Conversation IDs use a prefix so no persisted ID can alias the new-chat draft.
const NEW_CHAT_COMPOSER_DRAFT_KEY = 'new-chat'

/**
 * One captured long paste. The short visible `displayText` lives in the draft
 * text; `text` keeps the full payload. Labels embed a unique short ID, so an
 * exact label match — after any native undo/redo order — is the only way a
 * token re-associates with its payload.
 */
type ComposerPasteToken = {
  id: string
  text: string
  displayText: string
  start: number
  end: number
  state: 'active' | 'retired' | 'damaged'
  /** Broken label variants stay recoverable when a repair is undone. */
  damagedTexts: string[]
}

/** Renderer-owned state retained across navigation for this application run. */
type ChatComposerDraft = {
  text: string
  documents: ChatDocumentPart[]
  pasteTokens: ComposerPasteToken[]
  isSending: boolean
  sendError: string | null
}

const EMPTY_DRAFT: ChatComposerDraft = {
  text: '',
  documents: [],
  pasteTokens: [],
  isSending: false,
  sendError: null
}
const drafts = new Map<string, ChatComposerDraft>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getDraft(key: string): ChatComposerDraft {
  return drafts.get(key) ?? EMPTY_DRAFT
}

function updateDraft(key: string, update: (draft: ChatComposerDraft) => ChatComposerDraft): void {
  const current = getDraft(key)
  const next = update(current)
  if (next === current) return
  drafts.set(key, next)
  for (const listener of listeners) listener()
}

function clearDraft(key: string): void {
  if (!drafts.delete(key)) return
  for (const listener of listeners) listener()
}

/** Clear only the submitted content; edits made after submission survive. */
function acceptDraft(key: string, submitted: ChatComposerDraft): void {
  const current = getDraft(key)
  if (
    current.text === submitted.text &&
    current.documents === submitted.documents &&
    current.pasteTokens === submitted.pasteTokens
  )
    clearDraft(key)
  else updateDraft(key, (draft) => ({ ...draft, isSending: false, sendError: null }))
}

function composerDraftKey(conversationId: string | null | undefined): string {
  return conversationId ? `conversation:${conversationId}` : NEW_CHAT_COMPOSER_DRAFT_KEY
}

const chatComposerDrafts = { subscribe, getDraft, updateDraft, clearDraft, acceptDraft }

function useChatComposerDraft(
  key: string
): readonly [ChatComposerDraft, (update: (draft: ChatComposerDraft) => ChatComposerDraft) => void] {
  const draft = React.useSyncExternalStore(
    subscribe,
    () => getDraft(key),
    () => getDraft(key)
  )
  const update = React.useCallback(
    (patch: (draft: ChatComposerDraft) => ChatComposerDraft): void => updateDraft(key, patch),
    [key]
  )
  return [draft, update] as const
}

export {
  chatComposerDrafts,
  composerDraftKey,
  useChatComposerDraft,
  type ChatComposerDraft,
  type ComposerPasteToken
}
