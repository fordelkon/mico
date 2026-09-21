# Testing Principles

Use these rules when writing or changing tests. Anchor every scenario to user-visible behavior; keep dependencies real; let lint carry the mechanical rules and review carry the judgment calls. The repository's verification procedures live in [CLAUDE.md](../CLAUDE.md); this document owns the testing standards.

## Test Behavior, Not Implementation

- Test observable behavior and meaningful invariants, including relevant failure and edge cases. If a refactoring with no behavior change breaks a test, the test asserts implementation; rewrite it.
- Before adding a test, identify the regression it would catch. Code changes or coverage increases alone do not justify a test.
- Delegation assertions are acceptable only at an explicit seam whose observable contract is the delegation itself, such as the IPC boundary in `src/main/ipc.test.ts`.
- For regression fixes, demonstrate failure before the fix and success afterward, or report the evidence gap.

## Write the Scenario, Then the Code

- Write the acceptance scenario before the code. Every `it`/`test` title starts with `user` and states the scenario as a single Given/When/Then sentence — `user cannot place a duplicate order when resubmitting, then is charged only once`. `describe` names the unit or feature under test.
- Keep titles lean: one line (aim for ≈80 characters). The `then` clause states the visible outcome, never the mechanism. One scenario per test; no implementation specifics that a behavior-preserving refactor would invalidate.
- Never write tests that merely confirm the implementation the code already chose.

## Keep Dependencies Real

- Use real dependencies: in-memory SQLite, temporary directories, real child processes. Stub browser-environment APIs (clipboard, canvas, crypto) only at the test seam, with a justification comment.
- Replace unreachable external systems with fakes typed against their real contract, and validate that contract in tests. Every `vi.fn()` stub carries its function type (`vi.fn<() => void>()`) so the compiler checks the stub against the seam.
- Time logic uses `vi.useFakeTimers()` with `vi.advanceTimersByTime*()`. Concurrency uses deferreds, abort signals, and awaited iterators — never sleep and hope.

## Prefer End-to-End, Tier and Target the Rest

- Prefer tests that walk from the user entry point to a visible result, faking only external dependencies. Add narrower tests only when end-to-end is impractical.
- Tier tests by scenario. High-frequency CI runs the core business paths plus new and changed tests; the rest run on a slower cadence — a full run periodically, or on every change on an hourly schedule. Some non-core regressions surface later; the acceptable delay is a product decision, not a test decision.
- Target tests by changed code. Track which tests exercise which files, and after a source change run the affected set — Vitest's built-in related-test selection is a rough starting point. Prefer file-level granularity: function-level selection runs fewer tests but costs more to collect, analyze, and maintain. Config, dependency, and initialization changes reach many tests — run the full suite for those.
- Match the runner to the workload. Suites differ in CPU, memory, and IO pressure; size machines and concurrency to measured load, since more concurrency is not always faster. Prefer a local or self-hosted runner when it costs less than a hosted one for this workload.

## Let Lint Carry the Mechanical Rules

`pnpm test:lint` runs `oxlint --deny-warnings` followed by ESLint in check-only mode, so each rule below fails the check:

| Standard | Enforcement |
| --- | --- |
| BDD titles | `anti-slop/require-bdd-test-title` — `user` prefix, `when`/`then` keywords, 140-character cap |
| No mocking | `anti-slop/no-module-mocking` — bans `vi.mock`/`jest.mock` |
| No sleeping on real time | `anti-slop/no-sleep-in-tests` — bans `sleep`-style helpers, raw `setTimeout`/`setInterval`, and `timeout` options on `waitFor` |
| Vitest hygiene | `vitest/no-focused-tests`, `no-disabled-tests`, `no-identical-title`, `no-commented-out-tests`, `expect-expect`, `no-conditional-expect`, `valid-title`, `require-mock-type-parameters`, `require-to-throw-message` |

The custom `anti-slop` rules live in [tools/oxlint/anti-slop](../tools/oxlint/anti-slop) and are wired through [.oxlintrc.json](../.oxlintrc.json); test-scoped rules restrict themselves to test files, so helper modules can build titles dynamically. Shared test helpers live next to the domain they serve (`src/main/ai/tools/test-helpers.ts`, `packages/ai-providers/src/__tests__/test-helpers.ts`); extract one only when the same helper is duplicated identically in three or more files. Everything lint cannot express is a review convention in the sections above.

## Verify the Changed Contract

Apply the [repository verification requirements](../CLAUDE.md#verification). Before completing any test change, run `pnpm lint`, `pnpm typecheck`, `pnpm test:lint`, and `pnpm test`; add `pnpm build` when dependencies or build configuration change. When changing a lint rule, confirm it fires on a real violation and stays silent on the passing pattern. For UI behavior, inspect the affected flow in the running application as required by [UI Verification](../CLAUDE.md#ui-verification). Report which checks ran and any gaps; existing green checks do not prove every rule above is already satisfied.
