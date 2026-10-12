import type { ChatProvider } from '@mico/ai-providers'
import type { SessionSummary } from '@shared/data/schemas/session'
import { stripThinking } from './model-output'

const DEFAULT_SESSION_TITLE = 'New chat'
const MAX_SESSION_TITLE_CHARS = 50
const SESSION_TITLE_INSTRUCTIONS = `You are a conversation title generator.

Your ONLY task is to generate a concise, descriptive title for the conversation.
Output ONLY the title. Do not answer the user's request and do not include explanations.

<goal>
Generate a title that helps the user quickly recognize this conversation in a session list, distinguish it from similar conversations, and find it again through search.
</goal>

<output_rules>
- Output exactly one title on one line only.
- Do not use quotation marks, Markdown, a label such as "Title:", or trailing punctuation unless it is part of a technical identifier.
- Keep the title concise: prefer 3–8 English words or roughly 8–20 Chinese characters, with a hard limit of 50 characters whenever possible.
</output_rules>

<language>
- Use the same primary language as the user's request.
- Preserve technical terms in their conventional form. Do not unnecessarily translate library names, APIs, filenames, commands, model names, or product names.
</language>

<title_content>
Capture the user's actual goal rather than merely repeating the beginning of their message. Prefer the primary subject plus its operation, problem, or goal. Preserve details that make the conversation distinguishable and easy to find again, including important product names, technical concepts, files, components, libraries, error codes, model names, and relevant versions.
</title_content>

<constraints>
- Infer the task at one level above the literal wording; remove conversational filler.
- Prefer precise action concepts such as 修复, 排查, 优化, 实现, 配置, 重构, 迁移, 集成, 部署, 调试, 分析, 比较, 设计, 研究, 安装, 升级, or 解释 when appropriate.
- If a file is mentioned, title the task involving it rather than the filename alone.
- Never invent technical details or combine unrelated topics. For multiple topics, use the dominant current task.
- Always generate a meaningful title, even for a short conversational input.
</constraints>`

type SessionTitleUpdate = { sessionId: string; title: string }

type TitleGenerationRequest = {
  sessionId: string
  provider: ChatProvider
  sourceText: string
  signal: AbortSignal
  onTitleUpdated?: (update: SessionTitleUpdate) => void
}

type TitleGeneratorDependencies = {
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
  readonly #generatingSessions = new Set<string>()

  constructor(dependencies: TitleGeneratorDependencies) {
    this.#renameIfCurrentTitle = dependencies.renameIfCurrentTitle
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
      const stream = await provider.stream({
        messages: [
          { role: 'system', parts: [{ type: 'text', text: SESSION_TITLE_INSTRUCTIONS }] },
          { role: 'user', parts: [{ type: 'text', text: sourceText }] }
        ],
        thinkingEffort: 'none',
        signal
      })
      let generated = ''
      for await (const chunk of stream) {
        if (signal.aborted) return
        if (chunk.type === 'text-delta') generated += chunk.delta
      }
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
  const title = stripThinking(value)
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
