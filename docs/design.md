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
- The `architecture/process-imports` rule in [the ESLint plugin](../scripts/lint/architecture.mjs) checks process and package ownership for imports, re-exports, dynamic imports, and `require`. It resolves relative paths and process aliases before checking ownership. Its behavior tests run with the main test project.

## Keep Shared Modules Free of Special Cases

- A parameter serving only one or two callers is a question, not a verdict — good defaults also keep parameters unused. The smell is each new consumer requiring its own parameter and branch combination.
- When callers must combine flags carefully ("A needs this, B must not enable that"), the special logic belongs in the specific business or in a narrower interface, not in the shared module.

## Review What Is Expensive to Reverse

- Coupling and change-coupling metrics give hints; the question behind them is whether the cost of common changes keeps rising.
- Spend human review on decisions that are hard to reverse once wrong — ownership boundaries, interface shapes, abstraction seams — not on every line. Let the three checks above surface the evidence worth reviewing.

## Verify the Changed Contract

### Owned contracts in src

- Invoke task requests and results are defined in `src/shared/ipc/contracts.ts`. Main registration and the preload adapter use these schemas, and renderer method types are derived from them. Adding a task updates its contract and its task-specific handlers, not independent request and result declarations.
- A JSON document serializes mutations against its latest committed snapshot. The owner computes domain changes inside that operation; failed writes leave the committed state unchanged. Atomic file replacement is an internal persistence detail and does not promise power-loss durability.
- Active session activation applies only to the latest navigation intent. Request configuration comes from the sending session. Capability refresh and selection normalization belong to active session ownership, including when the composer changes models.
- First-send session creation captures the draft's project and request selections before persistence. A later navigation leaves that accepted response in the background instead of activating its session.
- Provider library ownership includes valid field drafts and their single serialized save queue. Commit drains edits made during an in-flight save; a failed save retains the draft for retry. Incomplete field text stays in the form and does not replace valid persisted values.
- Renderer theme consumers derive appearance and preference from one complete `ThemeState`. Bootstrap and mutation results cannot replace a newer notification. Preload exposes task capabilities and platform information without a generic Electron transport bridge.
- Workspace path ownership includes lexical and canonical target identity, protected-path interpretation, and target revalidation after approval. Tool authorization decides whether approval is required; tools resolve again before accessing the filesystem.
- Skill catalogs resolve registered project IDs in main; renderer requests cannot select filesystem roots. Skills default to `user-invocable: true`, independently of `disable-model-invocation`. A user message persists at most one `data-skill-invocation` part containing the exact skill ID, display name, and arguments. Explicit loading validates that ID against the current turn snapshot and requires user invocation permission; display names never select an alternative skill. Model tools may access a skill with model invocation disabled only when its exact ID has been authorized for that request. Low-level snapshot reads preserve manual access for the owning service.
- Tool execution captures settled facts and per-call timestamps. The model loop delivers those facts in submission order after the replayable step, preserving runtime event log ordering regardless of concurrent completion.
- Turn context preparation owns source lifetimes and request ordering. Accepted model-only context is durable and replayed once; `undefined` means unaccepted, while an empty array means accepted without extra context. Fresh project guidance remains ephemeral. Explicit skill authorization uses the exact invocation ID.
- Turn display assembly owns live chunk filtering, text limits, ordered reasoning/text/tool observations, and settled trace presentation for both completion and cancellation. Display limits do not truncate provider replay. Chunk accumulation is constant time; final projection traverses the collected observations.
- The internal session event log owns event encoding, digests, sequence allocation, context acceptance, and event projections. Session runtime owns lifecycle decisions and the transaction that combines lifecycle changes with event writes. Retrying an attempt resolves its original user message through the turn.
- Reopened renderer messages preserve exact skill invocation metadata. Conversation rename and deletion expose awaitable completion; failures retain the rename draft or restore the row and provide retry guidance.
- Provider catalog and model-selection actions reserve a serialized operation before awaiting draft saves. Remote catalog mutations reconcile authoritative models before whole-library saves; concurrent valid fields remain local. Failed reconciliation blocks stale saves until a later commit successfully retries the read.
- Native Quit waits for a bounded renderer draft-save attempt before synchronously cancelling active turns and closing storage, then resumes native exit once. Tray hiding does not trigger that drain. A settled acknowledgement is not a durability guarantee, and forced OS termination can bypass graceful shutdown.

Apply the [repository verification requirements](../CLAUDE.md#verification). For design changes, check the trend, not a score: external adaptations after internal changes are shrinking, boundary conventions are moving from documentation into enforced checks, and shared interfaces are not accumulating business-specific cases. Report the evidence and any gaps; no metric replaces business judgment.
