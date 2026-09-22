# E2E Testing Guide

End-to-end tests for the Mico Electron application using Playwright. Each test
launches the built application with an isolated `userData` directory, so tests
verify complete user outcomes across processes without touching real
application data.

## Directory structure

```
tests/e2e/
├── README.md                 # This guide
├── global-setup.ts           # Loads .env; fails fast when the build is missing
├── fixtures/
│   └── electron.fixture.ts   # Launch fixture: electronApp, mainWindow
├── utils/
│   ├── wait-helpers.ts       # App-ready waits
│   └── index.ts              # Utility exports
└── specs/                    # Test cases
    ├── app-launch.spec.ts    # Application launch boundary tests
    └── real-provider.spec.ts # Real LLM endpoint profile (skipped without credentials)
```

## Running tests

### Prerequisites

1. Install dependencies: `pnpm install`
2. Build the application: `pnpm build` (the launch fixture loads `out/` via the
   `main` entry in package.json)

### Commands

```bash
# Run the e2e suite (the real-provider spec skips without credentials)
pnpm test:e2e

# Run with visible windows
pnpm test:e2e --headed

# Run a specific test file
pnpm playwright test tests/e2e/specs/app-launch.spec.ts

# Run in debug mode (pauses execution and opens the inspector)
pnpm playwright test --debug

# View the test report
pnpm playwright show-report
```

## Writing E2E tests

Test design follows [docs/testing.md](../../docs/testing.md): BDD scenario
titles, real dependencies, fakes only for external systems. Provider chat is
verified against a real LLM endpoint configured by the user; the reply text is
model-controlled, so scenarios assert observable outcomes (a streamed
non-empty assistant message) instead of exact wording.

- Import `test` and `expect` from `fixtures/electron.fixture.ts`.
- Anchor waits to observable conditions (`utils/wait-helpers.ts`), never to delays.
- Refer to `playwright.config.ts` in the repository root for runtime settings.

## Configuration

`playwright.config.ts` in the repository root:

- `testDir`: `./tests/e2e/specs`
- `timeout`: 60 seconds per test, 10 seconds per assertion
- `workers`: 1 (Electron tests run sequentially)
- `retries`: 2 in CI, 0 locally

Application-level isolation comes from the `MICO_USER_DATA_DIR` environment
variable handled in `src/main/main.ts`: it redirects all persistence (databases,
preferences, workspaces) to a temporary directory, which also scopes the
single-instance lock so a test instance can run beside the installed app.

## Real provider credentials

`real-provider.spec.ts` runs against real LLM endpoints and is skipped unless
credentials are set. The profile follows one shared API key with one base URL
per protocol: each protocol is a separate provider entry created through the
settings UI, and a protocol's test runs only when its base URL and model are
configured, so you can enable one or both. The reply text is model-controlled,
so scenarios assert observable outcomes (a streamed non-empty assistant
message) instead of exact wording. The key field is password-masked, so
failure screenshots never expose it.

### Local setup

Copy the example file and fill in what you need:

```bash
cp .env.example .env
```

`.env` is gitignored and loaded automatically by global setup (real
environment variables win over `.env` entries). Uncomment the variables and
set real values:

```bash
MICO_E2E_API_KEY=...                    # shared across protocols
MICO_E2E_ANTHROPIC_BASE_URL=https://api.anthropic.com
MICO_E2E_ANTHROPIC_MODEL=claude-haiku-4-5
MICO_E2E_OPENAI_BASE_URL=https://api.openai.com/v1
MICO_E2E_OPENAI_MODEL=gpt-4o-mini
```

Model ids must match what the endpoint actually serves — the spec adds them
manually instead of discovering them. Real runs cost LLM credits; comment a
protocol's lines back out to skip it.

### CI

Put the key in repository/environment **secrets** (`MICO_E2E_API_KEY`) and the
endpoint values in **variables**; the `E2E` workflow passes them to the tests
and never echoes them into logs. Real-provider runs cost LLM credits, so the
workflow only runs them when manually dispatched.
