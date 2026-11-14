# Main AI Modules

Each module owns behavior behind its public root. Use relative imports inside an owner and public roots across owners. The architecture lint rule enforces the dependency graph and keeps portable model execution free of native persistence and IPC.

| Root | Owns |
| --- | --- |
| `conversation` | Session transactions and replay, turn admission, compaction orchestration, profiles, display, approvals, and shutdown |
| `execution` | Agent loop, bounded text requests, retry policy, execution facts, and the tool execution port |
| `context` | Provider request projection, observation budgets, summary input bounds, and approximate measurement |
| `prompt` | Harness policy and dedicated auxiliary-task instructions |
| `tools` | Capability composition, validation, authorization, hooks, tool execution, and path safety |
| `skills` | Discovery, snapshots, instruction documents, and contained resource reads |
| `workspace` | Registered project roots and captured workspace sources |
| `memory` | User/project knowledge, bounded retrieval, atomic revisions, and persistent deletion |
| `models` | Provider library, discovery, probes, provider resolution, and profile validation |

Conversation composes the other owners. Tools depend on execution contracts, skills, and memory; workspace depends on skills. Other AI modules have no cross-owner AI dependencies. Tests may compose real adapters across these directions while retaining public-root imports.

The loop emits execution facts through synchronous acknowledgements; conversation decides how to persist them. Context receives tool definitions and budget values, not an execution registry. Workspace supplies sources, not a configured agent. Memory never edits session history or checkpoints.

`main.ts` owns application composition and storage lifetime. IPC owns trusted sender identity, shared request validation, event delivery, and window ownership. See [design contracts](../../../docs/design.md#main-ai-modules) for automatic compaction, memory behavior, and lifecycle invariants; [testing principles](../../../docs/testing.md) own verification. Commands live in the root [package.json](../../../package.json).
