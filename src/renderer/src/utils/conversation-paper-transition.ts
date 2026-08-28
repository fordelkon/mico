import { flushSync } from 'react-dom'

type ConversationSelectionOptions = {
  focusComposer?: boolean
}

type SelectConversation = (conversationId: string, options?: ConversationSelectionOptions) => void

type SelectConversationWithPaperTransitionOptions = {
  activeConversationId: string | null
  conversationId: string
  options?: ConversationSelectionOptions
  selectConversation: SelectConversation
}

function selectConversationWithPaperTransition({
  activeConversationId,
  conversationId,
  options,
  selectConversation
}: SelectConversationWithPaperTransitionOptions): void {
  const select = (): void => selectConversation(conversationId, options)
  // Rename flows and reduced-motion preferences take priority over visual continuity.
  const shouldSkipTransition =
    activeConversationId === conversationId ||
    options?.focusComposer === false ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    !document.startViewTransition

  if (shouldSkipTransition) {
    select()
    return
  }

  document.startViewTransition(() => {
    // Commit synchronously so both conversation papers belong to the same transition.
    flushSync(select)
  })
}

export { selectConversationWithPaperTransition }
