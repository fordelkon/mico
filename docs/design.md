# Design Principles

Use these rules when designing, changing, or reviewing module boundaries. Tests verify today's behavior; they cannot answer whether this change made the next change harder. Watch the complexity of interactions between modules: how much detail of other modules a change must know, and how many cross-module conventions it must maintain. The repository's ownership boundaries live in [CLAUDE.md](../CLAUDE.md); this document owns how to judge and review them.

## Ask Whether the Interface Isolates Change

- When a module's internals change, its outside interface should rarely need to. Use git history to compare interface changes against implementation changes for each module.
- An interface change is not itself a problem when the business changed. The smell is an internal-only change dragging callers along: volatile internals leaked through the interface, or the responsibility and boundary need adjusting.
- When the ratio stays high, re-abstract, redesign the interface, or merge the modules.

## Enforce Boundaries with Mechanisms, Not Vigilance

- A boundary that relies on people remembering it is nominal. For each convention, measure how many of the places that could violate it are covered by an enforced check — raise that coverage, not the count of violations caught.
- Prefer the compiler, lint, and tests as enforcement. This repo enforces: the typed IPC surface as the only cross-process path, the public root as the only entry to `@mico/ai-providers`, and recurring anti-patterns through the [anti-slop rules](../tools/oxlint/anti-slop).
- When a concept gets a name, a request path, or a cancellation mechanism, allow exactly one of it. What cannot be enforced mechanically belongs on the review checklist below.

## Keep Shared Modules Free of Special Cases

- A parameter serving only one or two callers is a question, not a verdict — good defaults also keep parameters unused. The smell is each new consumer requiring its own parameter and branch combination.
- When callers must combine flags carefully ("A needs this, B must not enable that"), the special logic belongs in the specific business or in a narrower interface, not in the shared module.

## Review What Is Expensive to Reverse

- Coupling and change-coupling metrics give hints; the question behind them is whether the cost of common changes keeps rising.
- Spend human review on decisions that are hard to reverse once wrong — ownership boundaries, interface shapes, abstraction seams — not on every line. Let the three checks above surface the evidence worth reviewing.

## Verify the Changed Contract

Apply the [repository verification requirements](../CLAUDE.md#verification). For design changes, check the trend, not a score: external adaptations after internal changes are shrinking, boundary conventions are moving from documentation into enforced checks, and shared interfaces are not accumulating business-specific cases. Report the evidence and any gaps; no metric replaces business judgment.
