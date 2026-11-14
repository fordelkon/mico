import { SESSION_TITLE_INSTRUCTIONS } from '../prompt/title-instructions'
import type { ChatProvider } from '@mico/ai-providers'
import type { SessionSummary } from '../contracts'
import { prepareTextInput } from '../context/provider-input'
import type { TextGeneration } from '@mico/agent-core'

const DEFAULT_SESSION_TITLE = 'New chat'
const MAX_SESSION_TITLE_CHARS = 50
const MAX_GENERATED_TITLE_CHARS = 4096

type SessionTitleUpdate = { sessionId: string; title: string }

type TitleGenerationRequest = {
  sessionId: string
  provider: ChatProvider
  sourceText: string
  signal: AbortSignal
  onTitleUpdated?: (update: SessionTitleUpdate) => void
}

interface TitleGeneratorDependencies {
  textGeneration: TextGeneration
  renameIfCurrentTitle: (
    sessionId: string,
    currentTitle: string,
    title: string
  ) => SessionSummary | null
}

/**
 * Owns session title generation: when it runs (first turn only, once per
 * session), how the stream is normalized, and how the rename is persisted.
 * Title generation is best-effort and must never affect the user-visible chat
 * response.
 */
class TitleGenerator {
  readonly #renameIfCurrentTitle: TitleGeneratorDependencies['renameIfCurrentTitle']
  readonly #textGeneration: TextGeneration
  readonly #generatingSessions = new Set<string>()

  constructor(dependencies: TitleGeneratorDependencies) {
    this.#renameIfCurrentTitle = dependencies.renameIfCurrentTitle
    this.#textGeneration = dependencies.textGeneration
  }

  maybeGenerate(request: TitleGenerationRequest): void {
    if (!request.sourceText || this.#generatingSessions.has(request.sessionId)) return

    this.#generatingSessions.add(request.sessionId)
    void this.#generate(request).finally(() => {
      this.#generatingSessions.delete(request.sessionId)
    })
  }

  async #generate({
    sessionId,
    provider,
    sourceText,
    signal,
    onTitleUpdated
  }: TitleGenerationRequest): Promise<void> {
    try {
      const request = prepareTextInput({
        purpose: 'text',
        instructions: SESSION_TITLE_INSTRUCTIONS,
        text: sourceText,
        signal
      })
      const generated = await this.#textGeneration.generate({
        provider,
        request,
        maxOutputChars: MAX_GENERATED_TITLE_CHARS
      })
      const title = normalizeGeneratedTitle(generated)
      if (title && !signal.aborted) {
        const renamed = this.#renameIfCurrentTitle(sessionId, DEFAULT_SESSION_TITLE, title)
        if (renamed) onTitleUpdated?.({ sessionId, title: renamed.title })
      }
    } catch {
      // Best-effort: failures are swallowed by contract.
    }
  }
}

function normalizeGeneratedTitle(value: string): string | null {
  const title = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^(?:title|标题)\s*[:：]\s*/i, '')
    .trim()
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
    .replace(/[.!?。！？]+$/g, '')
    .trim()
  return title ? Array.from(title).slice(0, MAX_SESSION_TITLE_CHARS).join('') : null
}

export { TitleGenerator }
export type { SessionTitleUpdate }
