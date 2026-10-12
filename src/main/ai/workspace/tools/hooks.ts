import type { ToolCall } from './contract'

type ToolHookContext = Readonly<ToolCall> & { cwd: string; signal: AbortSignal }
type PreToolUseResult = { behavior: 'continue' } | { behavior: 'deny' | 'ask'; reason: string }
type ToolHookOutcome = ToolHookContext & { output: string; isError: boolean }
type ToolHooks = {
  preToolUse?: readonly ((context: ToolHookContext) => Promise<PreToolUseResult | void>)[]
  postToolUse?: readonly ((context: ToolHookOutcome) => Promise<void>)[]
  postToolUseFailure?: readonly ((context: ToolHookOutcome) => Promise<void>)[]
}

const HOOK_TIMEOUT_MS = 10_000

/** Limits waits and supplies a deadline signal to cooperative internal hooks. */
async function runHook<T>(
  signal: AbortSignal,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  signal.throwIfAborted()
  const controller = new AbortController()
  const abort = (): void => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  let timer: ReturnType<typeof setTimeout> | undefined
  const interrupted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
      once: true
    })
    timer = setTimeout(() => controller.abort(new Error('Tool hook timed out.')), HOOK_TIMEOUT_MS)
  })
  try {
    return await Promise.race([run(controller.signal), interrupted])
  } finally {
    if (timer) clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}

async function runPreToolUse(
  hooks: ToolHooks,
  context: ToolHookContext
): Promise<string | undefined> {
  let askReason: string | undefined
  for (const hook of hooks.preToolUse ?? []) {
    const result = await runHook(context.signal, (signal) => hook({ ...context, signal }))
    if (result?.behavior === 'deny') throw new Error(`Tool blocked by hook. ${result.reason}`)
    if (result?.behavior === 'ask') askReason = result.reason
  }
  return askReason
}

async function runPostToolUse(hooks: ToolHooks, context: ToolHookOutcome): Promise<void> {
  const handlers = context.isError ? hooks.postToolUseFailure : hooks.postToolUse
  for (const hook of handlers ?? []) {
    if (context.signal.aborted) return
    try {
      await runHook(context.signal, (signal) => hook({ ...context, signal }))
    } catch {
      // Observers cannot undo an executed operation or change its authoritative result.
      console.warn(
        `A ${context.isError ? 'postToolUseFailure' : 'postToolUse'} hook failed for ${context.toolName}.`
      )
    }
  }
}

export { runPreToolUse, runPostToolUse, type ToolHooks, type ToolHookContext }
