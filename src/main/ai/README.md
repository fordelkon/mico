# Main AI Modules

Main composes three module roots. Import another module through its root; sibling files and private implementation details use relative imports within their module.

| Root | Public entry | Owns |
| --- | --- | --- |
| `conversation` | `Conversations` | Session lifecycle, turn execution, replay, session model profiles, manual compaction, and execution shutdown |
| `workspace` | `Workspaces` | Project catalog, skill discovery and documents, project guidance, tool preparation and execution, authorization, and path safety |
| `models` | `Models` | Provider library, discovery and model probes, cached provider instances, and execution-profile validation |

`conversation` depends on `workspace` and `models`. Neither depends on conversation state or on the other. The architecture lint rule enforces this direction and public-root imports, including tests across modules.

`main.ts` owns application composition and storage lifetime. IPC owns typed request validation, trusted senders, renderer event delivery, and window ownership of pending requests.

See [design contracts](../../../docs/design.md#main-ai-modules) for interface ownership and [testing principles](../../../docs/testing.md) for verification. Commands live in the root [package.json](../../../package.json).
