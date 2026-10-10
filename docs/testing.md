# Testing Principles

Use these rules when writing, changing, reviewing, or auditing tests. Tests earn their maintenance cost by protecting observable behavior, meaningful invariants, or independent contracts. Let lint carry the mechanical rules and review carry the judgment calls. The repository's verification procedures live in [CLAUDE.md](../CLAUDE.md); this document owns the testing standards.

## Authoring Gate

Before adding or changing a test, answer all four questions:

1. What observable behavior, invariant, or independent contract does it protect?
2. What credible regression would make it fail?
3. Why would existing coverage not catch that regression? Each contract has one primary test owner at the strongest boundary that can independently prove it. Another layer needs a distinct risk, such as transport or lifecycle behavior the owner cannot reach. Prefer extending an existing table-driven case or fixture over duplicating the scenario.
4. Does it require an export, flag, wrapper, or injection hook that no production caller needs? If so, test through the real boundary instead.

A missing answer means the test is not ready. Code changes and coverage increases alone do not justify a test. Check each candidate against the low-value patterns below; retain a matching candidate only when it independently protects a contract under the retention criteria.

## Test Behavior, Not Implementation

- Test observable behavior and meaningful invariants, including relevant failure and edge cases. New tests must survive behavior-preserving implementation refactors. An existing test that breaks after source reorganization needs its contract examined before rewriting or deleting it.
- Delegation assertions are acceptable only at an explicit seam whose observable contract is the delegation itself, such as the IPC boundary in `src/main/ipc.test.ts`.
- For regression fixes, demonstrate failure on the pre-fix code for the intended reason and success after the owner-boundary repair. One regression at that owner covers the bug; do not repeat it at every layer it crosses. If baseline reproduction is unavailable, report the evidence gap without claiming the test proves the fix.

## Low-Value Patterns and Retention

Reject tests that only:

- Execute code without asserting an outcome, compare a value with itself, or copy identities.
- Copy fixtures, inventories, manifests, export lists, or source text instead of exercising a contract.
- Repeat private predicates or delegation call shapes already proved at a real boundary.
- Replay shared helper behavior in every provider or duplicate the same contract across layers.
- Preserve test-only exports, globals, wrappers, or production paths with no non-test callers.
- Generate expected values with the helper or renderer being tested, or use a fake that implements the asserted behavior.
- Supply successful receipts, persistence results, or callback ordering that the production owner should produce.
- Restate capability flags without exercising the delivery or acknowledgement they promise.
- Pass negative controls because a different guard rejects the input, or assert against storage the tested path never writes.
- Use names or fixtures that promise behavior the input and assertions do not exercise.

Keep independent public API, protocol, configuration, migration, storage, security, platform, default, package, release, and architecture contracts. Observable ordering and credible regressions also justify retention. Source inspection can be valuable when it is the cheapest independent guard of an externally meaningful key, byte, or path and survives identifier-only refactors. Static execution or slow runtime alone is not a reason to delete a test.

If a retained test fails on the baseline, investigate it as a possible product bug. Reproduce the failure and repair the owner when warranted; do not delete the test to make the suite pass.

## Write the Scenario, Then the Code

- Write the acceptance scenario before the code. Every `it`/`test` title starts with `user` and states the scenario as a single Given/When/Then sentence — `user cannot place a duplicate order when resubmitting, then is charged only once`. `describe` names the unit or feature under test.
- Keep titles lean: one line (aim for ≈80 characters). The `then` clause states the visible outcome, never the mechanism. One scenario per test; no implementation specifics that a behavior-preserving refactor would invalidate.
- Never write tests that merely confirm the implementation the code already chose.

## Keep Dependencies Real

- Use real dependencies: in-memory SQLite, temporary directories, real child processes. Stub browser-environment APIs (clipboard, canvas, crypto) only at the test seam, with a justification comment.
- Replace unreachable external systems with fakes typed against their real contract, and validate that contract in tests. Every `vi.fn()` stub carries its function type (`vi.fn<() => void>()`) so the compiler checks the stub against the seam.
- Types alone do not establish faithful behavior. Inspect dependency source or types when a test claims dependency-backed behavior. Fakes supply external inputs and failures; they must not manufacture the result the production owner is supposed to produce. Use existing production interfaces rather than adding test-only injection seams.
- Time logic uses `vi.useFakeTimers()` with `vi.advanceTimersByTime*()`. Concurrency uses deferreds, abort signals, and awaited iterators — never sleep and hope.

## Choose the Owning Boundary

- Choose the boundary that proves the contract directly with real internal dependencies. Module-level protocol, migration, storage, and security tests can own contracts without an end-to-end duplicate.
- End-to-end tests own critical user journeys and cross-process integration. Fake only external dependencies and verify the final outcome. Follow [tests/e2e/README.md](../tests/e2e/README.md) for Electron launch, isolation, provider fixtures, and coverage ownership.
- During iteration, run the focused owner and relevant sibling tests. Targeted selection does not replace the required repository checks before handoff. Commands and CI routing are owned by `package.json` and workflow configuration.

## Audit Existing Tests

Keep discovery read-only and report candidate evidence before editing. Read root and scoped repository instructions, the complete test and production owner, entry points, callers, callees, sibling implementations, overlapping coverage, CI routing, and relevant history. Prefer a few high-confidence candidates in one coherent owner-boundary batch over a speculative deletion inventory.

Before deleting a candidate, record:

- Exact test name and location, and the failure it can actually detect.
- Non-test callers of the covered production or support seam.
- Stronger remaining owner-boundary proof, or why no proof is needed.
- Relevant history and why the test or seam exists.
- Production or support code removal unlocked, risk, and focused validation command.

Missing evidence means the candidate is not ready for deletion. Move retained regressions to their canonical owners, consolidate duplicated setup and contract assertions, and remove obsolete test-only seams and dead paths in the same batch. Preserve uncertain candidates. Do not add replacement tests that restate the implementation or optimize for deletion count.

Never edit source or tests while Vitest is running in the checkout. After an audit, review the diff and report removed categories, owner simplifications, retained candidates and their contracts, verification actually run, remaining gaps, and production versus test/support line changes. Continue broader audits as separate coherent batches.

## Let Lint Carry the Mechanical Rules

`pnpm test:lint` runs `oxlint --deny-warnings` followed by ESLint in check-only mode. The following rules are explicitly enabled in [.oxlintrc.json](../.oxlintrc.json):

| Standard | Enforcement |
| --- | --- |
| BDD titles | `anti-slop/require-bdd-test-title` — `user` prefix, `when`/`then` keywords, 140-character cap |
| No module mocking | `anti-slop/no-module-mocking` — detects Vitest/Jest module-mocking calls; typed function stubs remain allowed |
| Deterministic waiting | `anti-slop/no-sleep-in-tests` — detects named sleep helpers, member timer calls, and member `waitFor` calls with timeout options |
| Vitest hygiene | `vitest/no-focused-tests`, `no-disabled-tests`, `no-identical-title`, `no-commented-out-tests`, `expect-expect`, `no-conditional-expect`, `no-test-prefixes`, `valid-title` |

The custom rules live in [tools/oxlint/anti-slop](../tools/oxlint/anti-slop). Detection is syntactic and does not prove test value, faithful fakes, complete timer coverage, or typed stubs. Review enforces those standards even when lint passes. Shared test helpers live next to the domain they serve (`src/main/ai/tools/test-helpers.ts`, `packages/ai-providers/src/__tests__/test-helpers.ts`); consolidate repeated setup when it represents the same domain scenario without adding flags for unrelated callers.

## Coverage Gate

CI runs `pnpm test:coverage` and uploads HTML and JSON summary reports for the
application, UI package, and provider package. Each Vitest configuration owns its
source scope and thresholds. Application coverage includes TypeScript sources;
UI coverage excludes Storybook stories. Untested production sources remain in the
reports.

The application branch and UI package thresholds currently preserve the measured
baseline below the 80% target. These are regression floors, not evidence that the
80% target is met. Raise them as independent behavioral coverage is added; do not
exclude production code or add implementation-mirroring tests to improve the
number. Provider thresholds already meet or exceed the target for all metrics.

## Verify the Changed Contract

Apply the [repository verification requirements](../CLAUDE.md#verification), including the required lint, type, test, build, and UI checks for the change. After audit edits, also run `git diff --check` and review `git diff --numstat`, separating production/tooling from tests and test support. When removing source inspections, execute the script or build that owns the claimed contract where applicable. When changing a lint rule, confirm it fires on a real violation and stays silent on the passing pattern. Report which checks ran and any gaps; existing green checks do not prove every rule above is already satisfied.
