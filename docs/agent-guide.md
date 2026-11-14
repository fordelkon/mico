# Agent Guide

## Verification

Use pnpm. Treat `package.json` scripts as the executable source of truth; use existing scripts rather than hand-rolled equivalents.

- Before completing any code change, run `pnpm lint` (required autofix and formatting), `pnpm typecheck`, `pnpm test:lint` (non-mutating lint check), and `pnpm test`.
- Also run `pnpm build` when changing build configuration, Vite/electron-vite configuration, or dependencies.
- Review autofix changes for scope and preserve unrelated user work.
- Report command failures and do not claim completion while required checks remain unresolved. State verification gaps explicitly; claim only what the checks actually establish.
- Keep command output concise without hiding actionable failures or verification evidence; rerun at normal verbosity when needed.

## Working Method

1. **Read context**: Before editing, read the README in the target directory and its parents, where present. Follow the task-specific references below.

The result satisfies the requested behavior and its direct dependents within the authorized scope. State material assumptions and acceptance evidence, preserve unrelated user work, and remove only code made obsolete by the change. When a failure exposes a reusable gap, fix or check it at its owning boundary; add instructions only when tooling cannot express the constraint.

## Development

See the root [README](../README.md) for setup and startup and [package.json](../package.json) for executable commands. Keep detailed task contracts at the destinations in the [root task index](../AGENTS.md#task-context).
