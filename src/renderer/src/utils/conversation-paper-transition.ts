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
    flushSync(select)
  })
}

export { selectConversationWithPaperTransition }
