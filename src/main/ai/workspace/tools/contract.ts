import type { ChatProviderTool, JsonObject } from '@mico/ai-providers'

import * as z from 'zod'

const MAX_READ_BYTES = 256 * 1024
const MAX_READ_LINES = 2_000
const MAX_WRITE_BYTES = 1024 * 1024
const MAX_BASH_OUTPUT_BYTES = 256 * 1024
const DEFAULT_BASH_TIMEOUT_MS = 120_000
// Bounds model history without changing complete tool results or persisted traces.
const MAX_TOOL_RESULT_HISTORY_BYTES = 64 * 1024

/** A bounded, in-progress fragment suitable for the chat's live tool output. */
type ToolOutputDelta = {
  stream: 'stdout' | 'stderr' | 'preview'
  delta: string
}
type ToolExecutionContext = {
  cwd: string
  signal: AbortSignal
  /**
   * Observes output while the tool is still running. Tool completion remains the
   * authoritative, persisted trace; consumers must tolerate dropped deltas.
   */
  onOutputDelta?: (delta: ToolOutputDelta) => void
}
type ToolExecutionResult = { output: string }
/** Complete fact emitted once a tool call has settled. */
type ToolExecutionTrace = {
  toolCallId: string
  toolName: string
  input: ToolInput
  isError: boolean
  output: string
  startedAt: number
  finishedAt: number
}
type ToolInput = JsonObject
type ToolCall = { toolCallId: string; toolName: string; input: ToolInput }
/** Effects derived from schema-validated input, independent of provider tool names. */
type ToolOperation =
  | { kind: 'read-only' }
  | { kind: 'file-read'; path: string }
  | { kind: 'file-write'; path: string; allowMissing: boolean }
  | { kind: 'command' }
  | { kind: 'unknown' }
/** A semantic rejection with a model-facing hint for recovering on retry. */
type ToolValidationFailure = { message: string }
/**
 * A tool in the Claude Code shape: one Zod schema generates both the provider
 * JSON Schema and the runtime validation, safety is declared per invocation
 * (the parsed input, not just the tool), and semantic checks are layered above
 * schema conformance.
 */
type AgentTool<Input> = {
  name: string
  description: string
  /** Fixed allowance for one output in model history; defaults to 64 KiB. */
  maxHistoryOutputBytes?: number
  /** Single source of truth; declare with z.strictObject so unknown keys reject. */
  inputSchema: z.ZodType<Input>
  /** Per-call parallel-safety. Receive the parsed input: the same tool can be safe for some inputs and not others. */
  isConcurrencySafe: (input: Input) => boolean
  /** Per-call effects for authorization; unclassified operations require approval. */
  operation: (input: Input) => ToolOperation
  /** Semantic validation beyond schema conformance; runs after safeParse, before execute. */
  validateInput?: (
    input: Input,
    context: ToolExecutionContext
  ) => Promise<ToolValidationFailure | null>
  execute: (input: Input, context: ToolExecutionContext) => Promise<ToolExecutionResult>
}
/** An AgentTool with the safety annotations left to the fail-closed defaults. */
type AgentToolDefinition<Input> = Omit<AgentTool<Input>, 'isConcurrencySafe' | 'operation'> &
  Partial<Pick<AgentTool<Input>, 'isConcurrencySafe' | 'operation'>>

// Fail closed: an unannotated tool runs serially and requires approval.
// A missing annotation costs performance, never safety.
const SAFE_DEFAULTS = {
  isConcurrencySafe: () => false,
  operation: (): ToolOperation => ({ kind: 'unknown' })
}

function defineAgentTool<Input>(tool: AgentToolDefinition<Input>): AgentTool<Input> {
  return { ...SAFE_DEFAULTS, ...tool }
}

/**
 * Projects the Zod schema onto the provider-facing JSON Schema. The `$schema`
 * key is stripped so the payload stays a plain object like the provider APIs
 * expect; refinements are intentionally unrepresented (runtime validation owns
 * them).
 */
function toProviderInputSchema<Input>(schema: z.ZodType<Input>): JsonObject {
  const { $schema: _omitted, ...jsonSchema } = z.toJSONSchema(schema, { io: 'input' })
  // SAFETY: z.record(z.string(), z.json()) parsed every value as JSON before this boundary.
  return z.record(z.string(), z.json()).parse(jsonSchema) as JsonObject
}

function emitToolOutputDelta(context: ToolExecutionContext, delta: ToolOutputDelta): void {
  try {
    context.onOutputDelta?.(delta)
  } catch {
    // Live UI observers are best-effort and must not affect tool execution.
  }
}

type RegisteredAgentTool = {
  definition: ChatProviderTool
  maxHistoryOutputBytes: number
  /**
   * Per-call evaluation against raw model input. Parse failure, a thrown
   * classification, or an unknown tool all fail closed to serial.
   */
  isConcurrencySafe: (input: ToolInput) => boolean
  prepare: (
    input: ToolInput,
    context: ToolExecutionContext
  ) => Promise<{
    operation: ToolOperation
    execute: () => Promise<ToolExecutionResult>
  }>
}

function registerTool<Input>(tool: AgentTool<Input>): RegisteredAgentTool {
  return {
    maxHistoryOutputBytes: tool.maxHistoryOutputBytes ?? MAX_TOOL_RESULT_HISTORY_BYTES,
    definition: {
      name: tool.name,
      description: tool.description,
      inputSchema: toProviderInputSchema(tool.inputSchema)
    },
    isConcurrencySafe(input) {
      const parsed = tool.inputSchema.safeParse(input)
      if (!parsed.success) return false
      try {
        return tool.isConcurrencySafe(parsed.data)
      } catch {
        // If classification throws (e.g. an unparseable command string),
        // treat as not concurrency-safe to be conservative.
        return false
      }
    },
    async prepare(input, context) {
      const parsed = tool.inputSchema.safeParse(input)
      if (!parsed.success) {
        const issues = parsed.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
          .join('; ')
        // Model-facing: state the failure and the recovery, not just a code.
        throw new Error(`Invalid tool input. ${issues}. Correct the arguments and retry.`)
      }
      const failure = await tool.validateInput?.(parsed.data, context)
      if (failure) throw new Error(failure.message)
      let operation: ToolOperation = { kind: 'unknown' }
      try {
        operation = tool.operation(parsed.data)
      } catch {
        // Unknown classifications require approval.
      }
      return { operation, execute: () => tool.execute(parsed.data, context) }
    }
  }
}

export {
  DEFAULT_BASH_TIMEOUT_MS,
  MAX_BASH_OUTPUT_BYTES,
  MAX_READ_BYTES,
  MAX_READ_LINES,
  MAX_WRITE_BYTES,
  MAX_TOOL_RESULT_HISTORY_BYTES,
  defineAgentTool,
  emitToolOutputDelta,
  registerTool,
  type AgentTool,
  type AgentToolDefinition,
  type RegisteredAgentTool,
  type ToolExecutionContext,
  type ToolExecutionResult,
  type ToolExecutionTrace,
  type ToolInput,
  type ToolCall,
  type ToolOperation,
  type ToolOutputDelta,
  type ToolValidationFailure
}
