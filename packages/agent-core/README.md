# @mico/agent-core

This private workspace package runs a model turn against a `ChatProvider` from `@mico/ai-providers`. Use it when the caller owns the messages, tool dispatcher, and response handling. For a project session with skills, approvals, and context compaction, use [`@mico/coding-agent`](../coding-agent/README.md).

## Run a model turn

`runModelLoop` returns a `Promise<void>`. Read streamed output from `emit` and use `onStep` to observe completed model steps, including tool results and continuation prompts.

```ts
import { runModelLoop } from '@mico/agent-core'
import type { ChatProvider } from '@mico/ai-providers'

export async function answer(provider: ChatProvider, question: string, signal: AbortSignal) {
  const chunks: string[] = []
  await runModelLoop({
    provider,
    messages: [{ role: 'user', parts: [{ type: 'text', text: question }] }],
    thinkingEffort: 'none',
    signal,
    emit(chunk) {
      if (chunk.type === 'text-delta') chunks.push(chunk.delta)
    }
  })
  return chunks.join('')
}
```

For tool-enabled requests, supply tool definitions in `prepareStep` and a `ToolExecutionPort` in `registry`. The loop prepares each logical step once. An eligible transport retry reuses that request before the first provider chunk arrives. Completed tool rounds remain in history. For durable execution, supply an `ExecutionJournal` and have the dispatcher call the start and settlement callbacks around each tool invocation. A rejected model-step acknowledgement stops dispatch.

For a bounded title or summary, `TextGeneration.generate` returns plain text and rejects tool calls, incomplete streams, and output beyond the caller's character limit. The owner can cancel outstanding requests with `dispose()` and await their settlement with `drain()`. See the [public exports](src/index.ts) and [provider guide](../ai-providers/README.md).

## Verify this package

From the workspace root, run `pnpm --filter @mico/agent-core test`, `pnpm --filter @mico/agent-core typecheck`, or `pnpm --filter @mico/agent-core test:coverage`. Open `packages/agent-core/coverage/index.html` for the package suite's coverage report.
