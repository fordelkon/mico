import type { ChatProviderMessage } from '@mico/ai-providers'
import type { ChatDocumentPart, ChatMessage } from '@shared/data/schemas/chat'

/**
 * The `<document name="…">` wire protocol every attached document follows when
 * it crosses into provider context. Document names are XML-attribute escaped so
 * a name can never terminate the tag or inject attributes; the body stays
 * verbatim because it is element text. Live turns, replayed turns, and title
 * generation must all serialize a document through this one function.
 */
function formatDocument(part: ChatDocumentPart): string {
  const name = part.name
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
  return `<document name="${name}">\n${part.text}\n</document>`
}

/**
 * The provider-visible form of a chat message in the active conversation:
 * renderer-only tool traces are dropped, documents become named text, and
 * every other part passes through unchanged.
 */
function toProviderContext(message: ChatMessage): ChatProviderMessage {
  return {
    ...message,
    // Tool traces are renderer-only persistence projections, never provider conversation context.
    parts: message.parts
      .filter((part) => part.type !== 'tool-trace' && part.type !== 'data-skill-invocation')
      .map((part) =>
        part.type === 'document' ? { type: 'text', text: formatDocument(part) } : part
      )
  }
}

/**
 * Provider context for a persisted turn replayed into a later request. Narrows
 * to text and documents because persisted reasoning may lack the provider
 * metadata that replaying thinking blocks requires; agent-step replay owns that
 * contract separately (see session-transcript.ts).
 */
function toProviderReplayContext(message: ChatMessage): ChatProviderMessage {
  return {
    role: message.role,
    parts: message.parts.flatMap((part) => {
      if (part.type === 'text') return [{ type: 'text' as const, text: part.text }]
      if (part.type === 'document') return [{ type: 'text' as const, text: formatDocument(part) }]
      return []
    })
  }
}

/** Plain-text projection of a message used as the source for title generation. */
function getMessageText(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.type === 'text' || part.type === 'document')
    .map((part) => (part.type === 'document' ? formatDocument(part) : part.text))
    .join('\n')
    .trim()
}

export { getMessageText, toProviderContext, toProviderReplayContext }
