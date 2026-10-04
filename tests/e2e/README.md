# E2E Testing Guide

Playwright launches the built Electron application with a fresh `userData`
directory and temporary workspace for every test. Relaunch tests reuse the same
storage without repeating setup. The fixture closes the application and removes
its temporary directories even when a scenario fails.

## Run

Install dependencies with `pnpm install`, then run `pnpm build`. Rebuild after
application source changes: Electron loads `out/`, not the development server.

```sh
# Deterministic local regression; no provider credentials or model charges
pnpm test:e2e --project=electron

# All projects; real-provider cases skip unless explicitly enabled
pnpm test:e2e

# Run one scenario file
pnpm test:e2e --project=electron tests/e2e/specs/tools.spec.ts

# Interactive debugging and failure report
pnpm test:e2e --project=electron --debug
pnpm playwright show-report
```

Runtime settings have one home in [playwright.config.ts](../../playwright.config.ts).
Tests run sequentially within each platform. The [E2E workflow](../../.github/workflows/e2e.yml)
runs local regression on Windows and macOS for pull requests and pushes to main.
The same workflow runs non-mutating lint, formatting, and regular test checks in a separate quality job.
Paid endpoint checks run only on manual dispatch with `real_provider` enabled.

## Coverage and ownership

| Area | Scenarios |
| --- | --- |
| Launch and composer | Window opens, editable composer, Shift+Enter preserves an unsent multiline draft |
| Appearance | Dark theme survives application restart |
| Chat | Two completed turns, partial stream versus completion, stop then send, provider failure then retry |
| Persistence | Completed answer and conversation title survive restart |
| Sessions | Rename and delete remain effective after restart |
| Workspaces | Add a real temporary directory through the settings flow |
| Navigation | Search from workspace settings returns to the conversation with renamed workspace labels in sidebar and composer |
| Tools | Real file creation, tool result replay, transcript and file after restart, failed file read |
| Real providers | Optional OpenAI-compatible and Anthropic-compatible completed replies |

The local regression replaces only the external model with a loopback HTTP server.
It accepts Chat Completions requests and sends SSE text, held streams, tool calls,
or errors. The application still uses its real provider adapter, IPC, tool
execution, filesystem, and database. This validates application behavior; it does
not establish compatibility with a deployed model endpoint.

- `fixtures/electron.fixture.ts`: Electron lifecycle, isolated storage/workspace,
  renderer error checks, and failure evidence.
- `fixtures/local-provider.fixture.ts`: local endpoint lifecycle and model setup
  through the real provider settings UI.
- `utils/local-provider.ts`: external protocol boundary; every foreground request
  consumes an explicitly queued response. Unexpected/malformed requests fail the
  fixture. Background title requests receive a separate deterministic title.
- `utils/provider.ts`: shared UI setup for local and real endpoints.
- `utils/chat.ts`: waits for a new assistant answer and its completed-message
  action, stopped generation, and restored editability. First text or a tool
  status alone is not completion.
- `specs/`: user scenarios; helpers do not register tests.

## Writing scenarios

Follow [docs/testing.md](../../docs/testing.md). Test full user outcomes with real
internal dependencies. Do not inject successful assistant messages or tool
results through IPC. File scenarios verify bytes in a new temporary workspace in
addition to visible UI results. The native folder chooser is stubbed only at its
OS boundary; directory management remains real.

Queue the next provider response before sending. A held stream is released by an
explicit test action after checking partial output, not by a sleep. For stop
scenarios, wait for the HTTP connection to close. Protocol scenarios may assert
the real application sends the executed tool result back to the provider.

Use `app.window` after `app.relaunch()`; derived `mainWindow` and `electronApp`
fixtures refer to the previous instance. Scope locators to named regions and
accessible controls. Existing `data-slot`/test-id boundaries distinguish actual
assistant body content from reasoning and tool summaries.

## Failure evidence

Electron's context is launched outside Playwright's default browser fixture.
The fixture therefore explicitly records [context traces](https://playwright.dev/docs/api/class-tracing)
and attaches [screenshots](https://playwright.dev/docs/api/class-testinfo#test-info-attach)
on failure. Each restart creates a new trace segment; passing-test traces are
removed. These context traces contain browser actions and snapshots, not the
runner's full assertion history. Video recording is not configured.

Real-provider scenarios never record traces because action arguments can contain
credentials. Password entry uses a native input update through evaluation rather
than `fill(secret)`, whose value Playwright includes in HTML report step titles. Failure screenshots mask password inputs. Renderer exceptions and
crashes fail scenarios; attached error messages redact the configured API key.
Keep credentials out of test titles, assertions, and application logs.

## Real provider checks

Copy `.env.example` to `.env` and configure one or both protocols. Global setup
loads `.env`; existing environment values take precedence. Never commit it.

```dotenv
MICO_E2E_API_KEY=...
MICO_E2E_OPENAI_BASE_URL=https://api.openai.com/v1
MICO_E2E_OPENAI_MODEL=gpt-4o-mini
MICO_E2E_ANTHROPIC_BASE_URL=https://api.anthropic.com
MICO_E2E_ANTHROPIC_MODEL=claude-haiku-4-5
```

Explicitly opt in when running these cases; they spend provider credits:

```sh
# macOS / Linux
MICO_E2E_REAL_PROVIDER=1 pnpm test:e2e --project=real-provider
```

```powershell
# PowerShell
$env:MICO_E2E_REAL_PROVIDER = '1'
pnpm test:e2e --project=real-provider
Remove-Item Env:MICO_E2E_REAL_PROVIDER
```

A protocol skips if its key, URL, or model is absent. Replies are model-controlled,
so real checks assert a nonempty completed assistant answer, not exact wording.
CI takes the API key from the `e2e` environment secret and endpoint/model settings
from environment variables in the workflow.

## Remaining coverage

Release-installer validation, real native dialogs, attachments, clipboard actions,
provider discovery, and broader theme/scrolling regressions are not yet covered by
this suite. Local protocol tests do not replace real-provider compatibility runs.
