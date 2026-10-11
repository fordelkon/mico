# @mico/ai-providers

`@mico/ai-providers` normalizes chat-provider protocols into AI SDK
`UIMessageChunk` streams. It preserves visible reasoning as a first-class
stream part and provides one transport contract for tool definitions, calls,
and results.

## Quick start

```ts
import { createChatProvider } from '@mico/ai-providers'

const provider = createChatProvider({
  provider: 'ollama',
  baseUrl: 'http://localhost:11434',
  modelId: 'granite4.2:3b'
})

const controller = new AbortController()
const stream = await provider.stream({
  messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello.' }] }],
  thinkingEffort: 'none',
  signal: controller.signal
})

for await (const chunk of stream) {
  if (chunk.type === 'text-delta') console.log(chunk.delta)
}
```

## Supported providers

- `openai-responses` — OpenAI Responses API
- `openai-compatible` — Chat Completions-compatible endpoints
- `anthropic-compatible` — Messages-compatible endpoints
- `ollama` — Ollama native `/api/chat` API

All adapters emit `reasoning-start`, `reasoning-delta`, `reasoning-end`, and
text chunks. The application owns message history. Provider-specific replay
data is carried in `providerMetadata`: Anthropic signatures stay on reasoning
parts.

LM Studio can be connected in the application as a custom `openai-compatible`
provider using its OpenAI-compatible server endpoint.

## Base URLs

For OpenAI-compatible, OpenAI Responses, and Anthropic-compatible providers,
`baseUrl` is an API root. A terminal version segment such as `/v1`, `/v2`, or
`/v3` is preserved and the protocol endpoint is appended beneath it. An
unversioned root receives the conventional `/v1` fallback. A fully specified
protocol endpoint is also accepted without duplication.

Ollama uses its native `/api/...` endpoints and never receives a `/v1`
fallback. All adapters preserve a configured gateway path prefix, such as
`https://gateway.example/ollama`.

## Model discovery

Use `discoverModels` before creating a chat provider to read the models exposed
by a configured endpoint. It returns normalized `{ modelId, displayName }`
entries, skips malformed entries, trims identifiers, and preserves the first
occurrence of each model ID.

```ts
import { discoverModels } from '@mico/ai-providers'

const models = await discoverModels({
  provider: 'openai-compatible',
  baseUrl: 'http://localhost:1234/v1'
})

// [{ modelId: 'qwen3-8b', displayName: 'qwen3-8b' }]

for (const model of models) console.log(model.modelId, model.displayName)
```

Provide `apiKey` for endpoints that require authentication. Discovery uses the
provider's native model-list API and auth convention:

| Provider | Model endpoint | Authentication |
| --- | --- | --- |
| `ollama` | `/api/tags` | None |
| `openai-responses` | `/v1/models` | Bearer token |
| `openai-compatible` | `/v1/models` | Optional bearer token |
| `anthropic-compatible` | `/v1/models` | `x-api-key` and `anthropic-version`; retries once with bearer authentication after a 401 |

## Tool transport

Callers define arbitrary tools with a name, description, and JSON input schema,
then pass them to `provider.stream()`. Supported adapters translate tool
definitions, completed calls, and call-result history to their native protocol
while emitting AI SDK `tool-input-*` chunks.

The package does not register or execute tools, validate input against an
application schema, make approval decisions, or own tool results. Those
responsibilities belong to the caller.

### Request a business tool

```ts
import {
  createChatProvider,
  type ChatProviderTool
} from '@mico/ai-providers'

const provider = createChatProvider({
  provider: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  modelId: 'example-model'
})

const convertCurrency: ChatProviderTool = {
  name: 'convert_currency',
  description: 'Convert an amount from one ISO 4217 currency to another.',
  inputSchema: {
    type: 'object',
    properties: {
      amount: { type: 'number' },
      from: { type: 'string' },
      to: { type: 'string' }
    },
    required: ['amount', 'from', 'to'],
    additionalProperties: false
  }
}

const controller = new AbortController()
const stream = await provider.stream({
  messages: [
    {
      role: 'user',
      parts: [{ type: 'text', text: 'Convert 100 EUR to USD.' }]
    }
  ],
  tools: [convertCurrency],
  thinkingEffort: 'none',
  signal: controller.signal
})

for await (const chunk of stream) {
  if (chunk.type === 'tool-input-available') {
    // Validate, authorize, and execute this request in the calling application.
    console.log(chunk.toolName, chunk.toolCallId, chunk.input)
  }
}
```

`tool-input-available` is the only executable tool chunk. Do not execute a
`tool-input-delta`: its input is intentionally incomplete.

### Replay a call and its result

Persist a completed call and its result before requesting the next model turn.
The original `toolCallId` must appear in both records.

```ts
import type { ChatProviderMessage } from '@mico/ai-providers'

const toolHistory: ChatProviderMessage[] = [
  {
    role: 'assistant',
    parts: [
      {
        type: 'tool-call',
        toolCallId: 'call_currency_1',
        toolName: 'convert_currency',
        argumentsJson: '{"amount":100,"from":"EUR","to":"USD"}'
      }
    ]
  },
  {
    role: 'tool',
    parts: [
      {
        type: 'tool-result',
        toolCallId: 'call_currency_1',
        toolName: 'convert_currency',
        output: '{"amount":108.42,"currency":"USD"}',
        isError: false
      }
    ]
  }
]

const nextStream = await provider.stream({
  messages: [
    { role: 'user', parts: [{ type: 'text', text: 'Convert 100 EUR to USD.' }] },
    ...toolHistory
  ],
  tools: [convertCurrency],
  thinkingEffort: 'none',
  signal: controller.signal
})
```

### Request a local file tool

The transport contract also works for local tools, but the caller must enforce
its own filesystem policy. For example, define `read` with a path argument,
verify that the requested path is within an approved workspace, then return a
`tool-result` with `isError: true` when it is not. Do not expose filesystem
access merely because a model requested it.

```ts
const readFile: ChatProviderTool = {
  name: 'read',
  description: 'Read an approved UTF-8 text file.',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
    additionalProperties: false
  }
}
```

| Provider | Tool definitions, calls, and replay |
| --- | --- |
| `openai-responses` | Supported |
| `openai-compatible` | Supported |
| `anthropic-compatible` | Supported |
| `ollama` | Supported |

Calls are emitted as executable `tool-input-available` chunks only after the
provider's native completion boundary and successful JSON parsing. Malformed
completed arguments emit `tool-input-error`. A native Responses output limit
retains its length finish and continuation even during partial tool arguments;
those arguments never become executable calls. Incomplete calls without this
native limit fail the stream. Handle these outcomes before continuing the conversation.

OpenAI Responses, OpenAI-compatible, and Anthropic-compatible adapters expose
the same five thinking preferences: off, low, medium, high, and extra-high.
They optimistically map a preference to their native request field. If an
endpoint rejects that field with a 400 or 422 response, the adapter retries
once without it and remembers that fallback for the rest of the app session.

## Provider failures and completion

`ProviderError`, exported from the package root, carries a safe `message` and
`kind`: `http`, `rate_limit`, `quota`, `context_overflow`, `transport`,
`incomplete_stream`, or `provider`. HTTP failures preserve `status` and valid
`Retry-After` metadata as `retryAfterMs` and `retryAt` (Unix milliseconds).
Raw provider payloads and upstream error messages/causes are never retained.
Context overflow requires an explicit recognized error code or a conservative
context-limit message; a 400 or 413 status alone is insufficient. Explicit
context-limit failures do not trigger thinking-parameter negotiation. Error
bodies are inspected for at most one second and 16 KiB; unread connections
are cancelled without delaying classification. Caller cancellation interrupts
inspection and never triggers a fallback request.

A stream succeeds only after native completion: Chat Completions requires a
nonempty `finish_reason`; `[DONE]` alone is insufficient. Anthropic requires `message_stop`,
Responses requires `response.completed` or `response.incomplete`, and Ollama
requires `done: true`. Native output limits remain `provider-finish` length
signals; a failed response or premature EOF throws instead of synthesizing a
successful finish. Caller cancellation remains an abort, while fetch network
TypeErrors and timeouts become safe `transport` failures.

## Provider testing

Use `testChatProvider` to verify that a configured model can complete a minimal
request. It consumes the complete response stream and returns timing metrics
that are safe to show in a provider settings UI. It verifies connectivity and
stream completion only; it does not evaluate response quality.

```ts
import { testChatProvider } from '@mico/ai-providers'

const result = await testChatProvider(
  {
    provider: 'ollama',
    baseUrl: 'http://localhost:11434',
    modelId: 'llama3.2'
  },
  { fetch, createId: () => crypto.randomUUID() }
)

// {
//   durationMs: 5364,
//   timeToFirstTokenMs: 684,
//   outputTokens: 42,
//   tokensPerSecond: 9.0
// }

if (result.tokensPerSecond) console.log(`${result.tokensPerSecond} tokens/second`)
```

`durationMs` is always present. `timeToFirstTokenMs`, `outputTokens`, and
`tokensPerSecond` are optional: a provider can only report them when its stream
supplies reliable token usage. Ollama uses native performance
statistics. OpenAI Responses, OpenAI-compatible, and Anthropic-compatible
providers use their streamed usage counters; the test helper derives throughput
from the first generated token through completion. The OpenAI-compatible test
request asks for standard `stream_options.include_usage`; endpoints that do not
return usage still succeed, but return timing only.

Pass the same provider dependencies used by the application, including `fetch`
and `createId`; tests may additionally supply `now` for deterministic timing.

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
