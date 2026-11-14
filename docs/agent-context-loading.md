# Agent Context Loading

## Entry points

[AGENTS.md](../AGENTS.md) owns the working agreement, completion gate, and task index. Project skills live in `.agents/skills/`, with Claude aliases in `.claude/skills/`. Personal skills and plugins are optional; project contracts remain reachable through root links.

Claude Code's [native AGENTS support](https://code.claude.com/docs/en/memory#agents-md) requires v2.1.277 or later (v2.1.281 or later for the broader session support described there). It must be enabled, and the default mode selects AGENTS only without a project/ancestor CLAUDE entry. Clients or modes without native discovery explicitly read AGENTS through the README entry. No additional root CLAUDE file is required for supported native discovery.

## Conditional context

The optional [Claude project hook](../.claude/hooks/context.mjs) is registered in [project settings](../.claude/settings.json). It requires Node.js and a trusted client that permits project hooks. The command uses `CLAUDE_PROJECT_DIR` rather than a machine-specific path.

For `Read`, `Edit`, and `Write`, the hook resolves canonical containment, including new paths and dangling symlink parents, before choosing context:

| File contract | Context |
| --- | --- |
| Source, package, or build configuration | [Agent guide](agent-guide.md) |
| Test or spec files, and test directories | [Testing](testing.md) |
| CSS | [Styling](styling.md) |
| Shared UI package source | [UI conventions](../packages/ui/README.md) |
| Provider package source | [Provider conventions](../packages/ai-providers/README.md) |
| Electron e2e paths | [E2E setup and isolation](../tests/e2e/README.md) |
| Public module entries, shared IPC contracts, or architecture lint | [Design](design.md) |
| Agent instructions, skills, hooks, or agent documentation | This contract and the agent guide |

The script is the executable authority for exact patterns. A document is emitted once per nonempty session ID and content hash. Empty marker files live in the OS temporary directory; the hook does not write project source or change authorization. The combined output stays at or below 9,500 characters. Documents that do not fit receive an explicit full-read notice instead of silent truncation.

`PreToolUse` context reaches the next model request. It cannot make an already-issued Edit reconsider its patch. The hook handles file tools, not shell reads; root task links remain the fallback before a contract-changing edit.

## Other clients and fallback

For shell reads, clients without this hook, or discovery failures, explicitly follow the task links in [AGENTS.md](../AGENTS.md). Read a project `SKILL.md` directly if the client cannot discover it. Codex has its own hook interfaces; this Claude registration does not prove Codex injection. No Codex hook configuration is installed by this change.

The [frontend skill](../.agents/skills/mico-frontend/SKILL.md) holds an on-demand Open Claude UI link. Fetch it only for the matching design decision; external documentation is not copied into project instructions.

## Evidence

The existing `pnpm test` main project includes the hook's real-subprocess tests in `scripts/lint/agent-context.test.mjs`. These prove routing, containment, deduplication, and output behavior, not client loading. Follow [context review](agent-context-audit.md) for independent fresh-session positive and negative probes and the removal ledger. Keep fallback links when a client cannot be tested; preserve its trust and permission controls.
