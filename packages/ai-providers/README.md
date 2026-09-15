# @mico/ai-providers

`@mico/ai-providers` is Mico's private workspace package for normalizing chat
providers into AI SDK `UIMessageChunk` streams. It keeps provider protocols out
of the main process and renderer while preserving visible reasoning as a
first-class stream part.

## Supported configurations

- `openai-responses` — OpenAI Responses API
- `openai-compatible` — Chat Completions-compatible endpoints
- `anthropic-compatible` — Messages-compatible endpoints
- `lm-studio` — LM Studio native API
- `ollama` — Ollama native `/api/chat` API

All adapters emit `reasoning-start`, `reasoning-delta`, `reasoning-end`, and
text chunks. The application owns message history. Provider-specific replay
data is carried in `providerMetadata`: Anthropic signatures stay on reasoning
parts, while LM Studio response IDs stay on assistant message metadata.

OpenAI Responses, OpenAI-compatible, and Anthropic-compatible adapters expose
the same five thinking preferences: off, low, medium, high, and extra-high.
They optimistically map a preference to their native request field. If an
endpoint rejects that field with a 400 or 422 response, the adapter retries
once without it and remembers that fallback for the rest of the app session.

## Usage

```ts
import { createChatProvider } from '@mico/ai-providers'

const provider = createChatProvider({
  provider: 'ollama',
  baseUrl: 'http://localhost:11434',
  modelId: 'granite4.2:3b'
})
```

## Model discovery

Use `discoverModels` before creating a chat provider to read the models exposed
by a configured endpoint. It returns normalized `{ modelId, displayName }`
entries, skips malformed entries, trims identifiers, and preserves the first
occurrence of each model ID.

```ts
import { discoverModels } from '@mico/ai-providers'

const models = await discoverModels({
  provider: 'lm-studio',
  baseUrl: 'http://localhost:1234'
})

// [{ modelId: 'qwen3-8b', displayName: 'Qwen3 8B' }]
```

Provide `apiKey` for endpoints that require authentication. Discovery uses the
provider's native model-list API and auth convention:

| Provider | Model endpoint | Authentication |
| --- | --- | --- |
| `lm-studio` | `/api/v1/models` | Optional bearer token |
| `ollama` | `/api/tags` | None |
| `openai-responses` | `/v1/models` | Bearer token |
| `openai-compatible` | `/v1/models` | Optional bearer token |
| `anthropic-compatible` | `/v1/models` | `x-api-key` and `anthropic-version`; retries once with bearer authentication after a 401 |

## Provider testing

Use `testChatProvider` to verify that a configured model can complete a minimal
request. It consumes the complete response stream and returns timing metrics
that are safe to show in a provider settings UI.

```ts
import { testChatProvider } from '@mico/ai-providers'

const result = await testChatProvider({
  provider: 'ollama',
  baseUrl: 'http://localhost:11434',
  modelId: 'llama3.2'
})

// {
//   durationMs: 5364,
//   timeToFirstTokenMs: 684,
//   outputTokens: 42,
//   tokensPerSecond: 9.0
// }
```

`durationMs` is always present. `timeToFirstTokenMs`, `outputTokens`, and
`tokensPerSecond` are optional: a provider can only report them when its stream
supplies reliable token usage. Ollama and LM Studio use native performance
statistics. OpenAI Responses, OpenAI-compatible, and Anthropic-compatible
providers use their streamed usage counters; the test helper derives throughput
from the first generated token through completion. The OpenAI-compatible test
request asks for standard `stream_options.include_usage`; endpoints that do not
return usage still succeed, but return timing only.

Run package checks from the repository root:

```bash
pnpm --filter @mico/ai-providers test
pnpm --filter @mico/ai-providers typecheck
```

## Test layout

Keep tests beneath `src/__tests__/` and group them by the source boundary they
exercise: provider protocol tests in `adapters/`, stream parser and emitter
tests in `streaming/`, and root-module tests alongside their owning module.
Do not add flat, unowned test files to the package test root.
