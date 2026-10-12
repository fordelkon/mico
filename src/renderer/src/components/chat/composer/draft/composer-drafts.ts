import type { ChatSkillInvocationPart } from '@shared/ai/skills'
import type { ChatDocumentPart } from '@shared/data/schemas/chat'
import * as React from 'react'
import { readCompactCommand } from '../composer-commands'
import { expandPasteTokens, pasteTokenIssue } from '../composer-paste-tokens'
import { createComposerDraftEditor } from './composer-draft-editor'
import type { ChatComposerDraft } from './composer-draft-types'

const NEW_CHAT_COMPOSER_DRAFT_KEY = 'new-chat'
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

/** Compare captured content identities, including payload metadata, before clearing an accepted send. */
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

type SubmitOptions = {
  canSend: boolean
  hasSelectedModel: boolean
  onSend: (content: {
    text: string
    documents: ChatDocumentPart[]
    skillInvocation?: ChatSkillInvocationPart['data']
  }) => Promise<boolean>
  onCompact?: () => void
  resolveInvocation: (text: string) => ChatSkillInvocationPart['data'] | undefined
}

async function submitDraft(key: string, options: SubmitOptions): Promise<void> {
  const submitted = getDraft(key)
  if (!options.canSend || submitted.isSending) return
  // Capture the key, content identities, and dispatch callbacks before any await.
  const { onSend, onCompact, resolveInvocation, hasSelectedModel } = options
  const text = expandPasteTokens(submitted.text, submitted.pasteTokens)
  const documents = submitted.documents
  const setError = (sendError: string | null): void =>
    updateDraft(key, (current) => ({ ...current, sendError }))
  const command = readCompactCommand(submitted.text)
  if (command) {
    if (!onCompact) {
      setError('Choose an existing conversation before using /compact. Your draft is kept.')
      return
    }
    if (command.arguments) {
      setError(
        'The /compact command takes no arguments. Send it on its own, or send your text as a normal message.'
      )
      return
    }
    if (documents.length) {
      setError(
        'The /compact command does not support attachments. Remove them or send them as a normal message.'
      )
      return
    }
    setError(null)
    clearDraft(key)
    onCompact()
    return
  }
  const issue = pasteTokenIssue(submitted.text, submitted.pasteTokens)
  if (issue) {
    setError(issue)
    return
  }
  if (!hasSelectedModel || (!text.trim() && !documents.length)) return
  updateDraft(key, (current) => ({ ...current, isSending: true, sendError: null }))
  try {
    // Resolve and validate skill arguments only after captured payloads have expanded.
    const skillInvocation = resolveInvocation(text)
    const content = skillInvocation ? { text, documents, skillInvocation } : { text, documents }
    if (await onSend(content)) acceptDraft(key, submitted)
  } catch (cause) {
    const detail = cause instanceof Error ? ` ${cause.message}` : ''
    updateDraft(key, (current) => ({
      ...current,
      isSending: false,
      sendError: `Could not send this message.${detail} Your draft and attachments are kept. Try again.`
    }))
  } finally {
    updateDraft(key, (current) => (current.isSending ? { ...current, isSending: false } : current))
  }
}

function composerDraftKey(conversationId: string | null | undefined): string {
  return conversationId ? `conversation:${conversationId}` : NEW_CHAT_COMPOSER_DRAFT_KEY
}

const chatComposerDrafts = { subscribe, getDraft, updateDraft, clearDraft }

type ComposerDraftActions = ReturnType<typeof createComposerDraftEditor> & {
  setDocuments: (documents: ChatDocumentPart[]) => void
  submit: (options: SubmitOptions) => Promise<void>
}

/** Drafts and every action remain bound to their conversation key across navigation. */
function useChatComposerDraft(key: string): readonly [ChatComposerDraft, ComposerDraftActions] {
  const draft = React.useSyncExternalStore(
    subscribe,
    () => getDraft(key),
    () => getDraft(key)
  )
  const actions = {
    ...createComposerDraftEditor({
      get: () => getDraft(key),
      update: (change) => updateDraft(key, change)
    }),
    setDocuments(documents: ChatDocumentPart[]): void {
      updateDraft(key, (current) => ({ ...current, documents, sendError: null }))
    },
    submit(options: SubmitOptions): Promise<void> {
      return submitDraft(key, options)
    }
  }
  return [draft, actions] as const
}

export { chatComposerDrafts, composerDraftKey, useChatComposerDraft }
