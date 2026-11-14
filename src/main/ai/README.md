# Desktop AI Host

The main process connects the coding agent to desktop storage, approvals, and event delivery.

| Module | Responsibility |
| --- | --- |
| `conversation` | SQLite session transactions, journal and replay, pending window approvals, and composition of the coding agent |
| `models` | Provider settings, model discovery, provider construction, and saved profile resolution |
| `workspace` | Registered project roots and workspace selection |
| `memory` | Atomic user and project memory storage, revision checks, and deletion |

[`@mico/coding-agent`](../../../packages/coding-agent/README.md) owns tools, skill discovery, prompts, context projection, and session orchestration. The host implements its interfaces and forwards events through the typed IPC surface. The environment-neutral `@mico/coding-agent/contracts` entry supplies the schemas used by main, preload, and renderer.

See [design and lifecycle contracts](../../../docs/design.md#main-ai-modules) for the ownership of admission, compaction, recovery, and shutdown.
