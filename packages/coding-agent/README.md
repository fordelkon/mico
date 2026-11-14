# @mico/coding-agent

This private workspace package runs coding sessions in a Node host. `CodingAgent` prepares project instructions, skills, remembered context, and workspace tools for each turn. It coordinates model selection, streaming, recovery, and context compaction using [`@mico/agent-core`](../agent-core/README.md).

## Connect a host

Construct a `CodingAgent` with `CodingAgentOptions`. The host supplies three required dependencies.

| Option | Host responsibility |
| --- | --- |
| `runtime` | Implement `SessionStore` to preview and accept turns, supply replay history, record execution facts, and commit checkpoints or compaction notices. |
| `models` | Resolve a provider for the selected or saved execution profile and supply model capabilities. |
| `requestApproval` | Obtain a decision for the requested tool operation, scoped to its owner, session, and request. Honor cancellation while waiting. |

Create the session in the host store before calling `startTurn`. The method starts work and returns immediately. Its listener receives streamed chunks, retry and context measurements, and the terminal outcome. Keep the agent instance across turns so cancellation and compaction address the active session work.

```ts
import { CodingAgent, type CodingAgentOptions } from '@mico/coding-agent'
import type { TurnStartRequest, TurnStreamEvent } from '@mico/coding-agent/contracts'

// Values supplied by the host for an existing session.
declare const host: CodingAgentOptions
declare const ownerId: string
declare const request: TurnStartRequest
declare const deliver: (event: TurnStreamEvent) => void

const agent = new CodingAgent(host)
agent.startTurn({ ownerId, request }, deliver)
```

Use `abortTurn({ ownerId, requestId })` to cancel a turn and await settlement. Use `compact(sessionId)` to request a checkpoint. At shutdown the desktop host stops compaction, saves pending drafts, and awaits `drain()` before closing storage. See the [desktop adapter](../../src/main/ai/conversation/conversations.ts) and [session lifecycle](../../docs/design.md#main-ai-modules).

## Share data with the UI

Use the Node [package root](src/index.ts) for execution. Import message, skill, permission, and session data from [`@mico/coding-agent/contracts`](src/contracts/index.ts) in shared code, preload, and renderer. This entry exposes types and runtime validators such as `TurnStartRequestSchema` and `TurnStreamEventSchema`. Electron owns IPC registration, sender validation, and event delivery.

## Verify this package

From the workspace root, run `pnpm --filter @mico/coding-agent test`, `pnpm --filter @mico/coding-agent typecheck`, or `pnpm --filter @mico/coding-agent test:coverage`. Open `packages/coding-agent/coverage/index.html` for the package suite's coverage report. SQLite and desktop integration scenarios also exercise the public agent in the [application suite](../../docs/testing.md#coverage-gate).
