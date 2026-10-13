# Mico

Mico is a desktop AI workspace and coding assistant built with Electron, React, and TypeScript.

The current focus is building a lightweight **toy agent** harness directly into the application, drawing inspiration and architectural patterns from modern open-source projects:

- **Agent Core & Harness**:
  - **[Pi](https://github.com/earendil-works/pi)** (`pi-coding-agent`): Modular agent loop design, minimal core abstractions, and extensible tool contracts.
  - **[OpenAI Codex](https://github.com/openai/codex)**: Stream-driven agent interactions, project instruction ingestion, and execution boundaries.
  - **[dsh](https://github.com/deepseek-ai/deepseek-harness)** (DeepSeek Harness): Flexible harness architecture, modular tool composition, and transparent execution traces.
- **Frontend & Workspace UI**:
  - **[shadcn/ui](https://github.com/shadcn-ui/ui)**: Accessible, composable UI component primitives and token-based styling powering `@mico/ui`.
  - **[Lody](https://github.com/LodyAI/Lody)**: Modern coding agent workspace ergonomics, multi-turn interaction design, and activity monitoring.

## Overview & Architecture

Mico explores how modern agent concepts translate into a responsive, desktop-first developer experience:

- **Agent Runtime & Model Loop**: Event-journaled conversation runtime, multi-turn reasoning loops, session replay, and turn budget management.
- **Workspace Context & Instructions**: Automatic discovery and hierarchical precedence for project guidance (`AGENTS.md`, `CLAUDE.md`, etc.).
- **Agent Tools & Execution Guardrails**: Built-in filesystem and shell tools (`read`, `write`, `edit`, `bash`, `search`) with declarative token budgets, target revalidation, and user approval workflows.
- **Skills Interoperability**: Support for the emerging Agent Skills standard across compatibility directories (`.agents/skills`, `.claude/skills`, `.codex/skills`, `.gemini/skills`, etc.).
- **Observable Execution UI**: Real-time streaming UI featuring collapsible reasoning blocks, tool call timelines, diff viewers, and terminal output viewports.
- **Strict Process Boundaries**: Clean Electron separation — browser-only React renderer, secure typed IPC preload bridge, and isolated native AI orchestration in the main process.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Biome](https://marketplace.visualstudio.com/items?itemName=biomejs.biome) + [Oxc (oxlint)](https://marketplace.visualstudio.com/items?itemName=oxc.oxc-vscode)

## Project Setup

### Install

```bash
$ pnpm install
```

### Development

```bash
$ pnpm dev
```

### Verification & Testing

```bash
# Linting and formatting
$ pnpm lint
$ pnpm test:lint

# Type checking
$ pnpm typecheck

# Unit tests
$ pnpm test
```

### Build

```bash
# For Windows
$ pnpm build:win

# For macOS
$ pnpm build:mac

# For Linux
$ pnpm build:linux
```
