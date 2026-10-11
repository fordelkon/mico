import type { UIMessageChunk } from 'ai'
import * as z from 'zod'

const ToolArgumentsSchema = z.record(z.string(), z.json())

import type { JsonValue } from '../contracts'

/** A completed call's arguments: either the validated record or the raw value preserved for the error chunk. */
type ValidatedToolArguments =
  | { isValid: true; input: Record<string, JsonValue> }
  | { isValid: false; invalidInput: JsonValue }

type ToolCallAssembler = {
  /** Emits tool-input-start at most once per toolCallId. */
  start: (toolCallId: string, toolName: string) => UIMessageChunk[]
  delta: (toolCallId: string, inputTextDelta: string) => UIMessageChunk[]
  /**
   * Terminal chunk for arguments received as a JSON text: available with the
   * parsed object on success, error with the raw text preserved on failure.
   */
  completeJson: (toolCallId: string, toolName: string, argumentsJson: string) => UIMessageChunk[]
  /**
   * Terminal chunk for arguments received as an already-parsed JSON value that
   * the caller validated against the protocol's record shape.
   */
  completeValue: (
    toolCallId: string,
    toolName: string,
    parsed: ValidatedToolArguments
  ) => UIMessageChunk[]
}

function createToolCallAssembler(errorText: string): ToolCallAssembler {
  const started = new Set<string>()
  const start = (toolCallId: string, toolName: string): UIMessageChunk[] => {
    if (started.has(toolCallId)) return []
    started.add(toolCallId)
    return [{ type: 'tool-input-start', toolCallId, toolName }]
  }
  return {
    start,
    delta: (toolCallId, inputTextDelta) => [
      { type: 'tool-input-delta', toolCallId, inputTextDelta }
    ],
    completeJson: (toolCallId, toolName, argumentsJson) => {
      try {
        return [
          {
            type: 'tool-input-available',
            toolCallId,
            toolName,
            input: ToolArgumentsSchema.parse(JSON.parse(argumentsJson))
          }
        ]
      } catch {
        return [{ type: 'tool-input-error', toolCallId, toolName, input: argumentsJson, errorText }]
      }
    },
    completeValue: (toolCallId, toolName, parsed) =>
      parsed.isValid
        ? [{ type: 'tool-input-available', toolCallId, toolName, input: parsed.input }]
        : [
            {
              type: 'tool-input-error',
              toolCallId,
              toolName,
              input: parsed.invalidInput,
              errorText
            }
          ]
  }
}

export { createToolCallAssembler }
export type { ToolCallAssembler }
