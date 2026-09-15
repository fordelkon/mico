# Repository Instructions

## Working Agreement

- Use Chinese for conversation; English for code, comments, documentation, UI strings, and commit messages.
- Inspection requests authorize reporting only. Change requests authorize the root-cause fix, its direct dependents, and relevant verification within scope.
- Ground before asking: inspect the relevant source first. Ask only for unresolved material ambiguity, missing access, material scope expansion, or unauthorized high-impact action. Continue authorized work that does not depend on the answer.

## Task Workflow

1. **Read context**: Before editing, read the README in the target directory and its parents, where present. Follow the task-specific references below.
2. **Define done**: Reconstruct the intended outcome from the request and available evidence. State material assumptions and acceptance criteria before choosing an approach. For multi-step tasks, give a brief plan with a verification check for each step.
3. **Implement**: Make the smallest complete change that satisfies the outcome, without speculative features or abstractions. Preserve unrelated user changes, match local conventions, and remove only code made obsolete by the task.
4. **Verify**: During iteration, run relevant focused checks, inspect failures, fix their causes, and rerun checks autonomously. Apply the completion requirements under Verification before handing off.
5. **Report**: Explain the resulting behavior, verification performed, and remaining gaps. When a failure reveals a reusable gap, prefer a check or fix at the owning boundary; add instructions only when tooling cannot express the constraint. Keep improvements within the authorized scope.

## Architecture and Ownership

Mico follows Electron's three-process model. Keep domain state with its owner and communicate across processes only through the typed IPC surface.

- `src/renderer/`: browser-only React product UI; consumes `window.api` and shared types, never Electron or Node APIs directly.
- `src/preload/`: security boundary; exposes typed, task-focused capabilities and hides Electron transport details.
- `src/main/`: native resources, application lifecycle, persistence, and service composition. IPC validates untrusted renderer input before delegating to the owning service.
- `src/shared/`: environment-neutral domain schemas, IPC request/response schemas, and channel names; no browser, Node, or Electron dependencies.
- `packages/ui/`: reusable UI primitives and composites. Keep product-specific compositions in the renderer.
- `packages/ai-providers/`: provider adapters, protocol parsers, normalized stream parts, and model thinking-capability mappings. Keep application configuration and service composition in main.

Fix limitations at the owning module rather than compensating in consumers. Proceed with root-cause fixes within scope; discuss changes that exceed the authorized contract or require restructuring the architecture.

### Imports and Infrastructure

- Use relative imports for siblings and private details within a feature or domain.
- Use process-root aliases only for stable cross-domain imports: `@main/*`, `@renderer/*`, and `@shared/*`. Add aliases only for established boundaries with multiple consumers.
- Consume workspace packages through their public APIs. Import `@mico/ai-providers` only from its public root; expose an intentional contract there before adding a new consumer.
- Keep aliases consistent across affected Electron-Vite and TypeScript configurations. Keep build, type-check, and lint configuration process-aware and separate from application-domain code.
- Prefer `@electron-toolkit/*` utilities and established library features over custom infrastructure.

## Verification

Use pnpm. Treat `package.json` scripts as the executable source of truth; use existing scripts rather than hand-rolled equivalents.

- Before completing any code change, run `pnpm lint` (required autofix and formatting), `pnpm typecheck`, `pnpm test:lint` (non-mutating lint check), and `pnpm test`.
- Also run `pnpm build` when changing build configuration, Vite/electron-vite configuration, or dependencies.
- Review autofix changes for scope and preserve unrelated user work.
- Report command failures and do not claim completion while required checks remain unresolved. State verification gaps explicitly; claim only what the checks actually establish.
- Keep command output concise without hiding actionable failures or verification evidence; rerun at normal verbosity when needed.

### Test Quality

- Test observable behavior and meaningful invariants independently of the implementation, including relevant failure and edge cases. Before adding a test, identify the regression it would catch; code changes or coverage increases alone do not justify a test.
- For regression fixes, demonstrate failure before the fix and success afterward, or report the evidence gap.
- Prefer deterministic coordination or controlled scheduling over sleeps for concurrency tests.

### UI Verification

- For UI behavior or layout changes, inspect the affected flow in the running application. Verify relevant states and interactions, such as loading/error states, keyboard focus, window resizing, themes, streaming, and scrolling.
- Check relevant runtime errors and report what was observed. If runtime inspection is unavailable, disclose the gap; passing static checks does not establish visual or interaction correctness.

## Change Conventions

### Copy and Documentation

- User-visible errors explain what happened, where, and what the user can do next.
- Keep one canonical home per fact; link instead of restating. Document stable contracts and procedures, and point to scripts or configuration for changing values.
- Keep READMEs focused on orientation and entry points; place detailed contracts, procedures, and design rationale in corresponding documents.
- Describe the final behavior. After behavior changes, update affected UI strings, tooltips, errors, documentation, agent instructions, and metadata.
- Support claims such as "recommended", "faster", and "better" with project evidence.
- Comments explain rationale, invariants, safety constraints, or external quirks. Public API documentation describes observable contracts.

### Files and Commits

- Regenerate build output such as `out/` and `dist/` instead of hand-editing it. `build/` also contains source assets and packaging configuration; distinguish those from generated files before editing.
- Treat `tools/` as vendored code; leave it untouched during unrelated work.
- Use conventional commits: `type(scope): summary`, with a specific lowercase kebab-case scope matching existing history. Keep each commit focused and independently reviewable.

## Task-specific References

- Before changing CSS, component styling, or themes, read [docs/styling.md](docs/styling.md) for token ownership, theme boundaries, styling scope, and verification.
- When adding or changing shared UI components, read [packages/ui/README.md](packages/ui/README.md) for component, story, and test conventions.
- When changing provider adapters, protocols, or discovery, read [packages/ai-providers/README.md](packages/ai-providers/README.md).
- When changing package-manager or workspace configuration, read the comments in `pnpm-workspace.yaml` for policy and rationale.
- For setup and application startup, see [README.md](README.md); for available development and packaging commands, inspect `package.json`.
