# Repository Instructions

## Working Agreement

- Use Chinese for conversation; English for code, comments, documentation, UI strings, and commit messages.
- Inspection requests authorize reporting only. Change requests authorize the root-cause fix, its direct dependents, and relevant verification within scope.
- Ground before asking: inspect the relevant source first. Ask only for unresolved material ambiguity, missing access, material scope expansion, or unauthorized high-impact action. Continue authorized work that does not depend on the answer.
- State the intended outcome, material assumptions, and completion evidence. Preserve unrelated user changes; keep implementation within the authorized contract.

## Completion

Use pnpm. Treat `package.json` scripts as the executable source of truth; use existing scripts rather than hand-rolled equivalents.

Before handoff, apply [project verification](docs/agent-guide.md#verification). Report resulting behavior, command outcomes, and unresolved checks. Partial checks do not establish aggregate success.

## Files and Commits

- Regenerate build output such as `out/` and `dist/` instead of hand-editing it. `build/` also contains source assets and packaging configuration; distinguish those from generated files before editing.
- Treat `tools/` as vendored code; leave it untouched during unrelated work.
- Use conventional commits: `type(scope): summary`, with a specific lowercase kebab-case scope matching existing history. Keep each commit focused and independently reviewable.

## Task Context

- Before editing source or configuration: [working method](docs/agent-guide.md#working-method).
- Process or module boundaries, public interfaces, or imports: [design and ownership](docs/design.md).
- Writing, changing, reviewing, or deleting tests: [testing principles](docs/testing.md).
- UI behavior, CSS, styling, or themes: [styling and runtime verification](docs/styling.md).
- Frontend design: [project frontend skill](.agents/skills/mico-frontend/SKILL.md).
- Shared UI components: [UI package conventions](packages/ui/README.md).
- Provider adapters, protocols, or discovery: [provider conventions](packages/ai-providers/README.md).
- Writing or running e2e tests: [launch, credentials, and isolation](tests/e2e/README.md).
- Documentation or user-visible errors: [copy and documentation](docs/contributing.md).
- Workspace configuration: comments in `pnpm-workspace.yaml`.
- Setup and startup: [README](README.md); command definitions: `package.json`.
- Instructions, skills, or context hooks: [context loading](docs/agent-context-loading.md) and [context review](docs/agent-context-audit.md).

When enabled, the [Claude project hook](.claude/hooks/context.mjs) supplies matching context. For shell reads or other clients, follow these task links explicitly; a document does not load merely because it exists.
