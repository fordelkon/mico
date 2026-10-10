import * as React from 'react'
import * as z from 'zod'

import { ChatCodeBlock } from '../../../markdown/chat-code-block'

type FormattedToolPayload = { language: 'json' | 'text'; text: string }
const GenericToolPayloadValueSchema = z.union([z.json(), z.undefined()])
type GenericToolPayload = z.infer<typeof GenericToolPayloadValueSchema>

const GenericToolPayloadSchema = z.union([
  z.string().transform((text): FormattedToolPayload => ({ language: 'text', text })),
  z.json().transform(
    (value): FormattedToolPayload => ({
      language: 'json',
      text: JSON.stringify(value, null, 2) ?? 'No data.'
    })
  ),
  z.undefined().transform((): FormattedToolPayload => ({ language: 'text', text: 'No data.' }))
])

function formatGenericToolPayload(payload: GenericToolPayload): FormattedToolPayload {
  return GenericToolPayloadSchema.parse(payload)
}

function GenericToolTrace({
  input,
  output
}: {
  input: FormattedToolPayload
  output: FormattedToolPayload
}): React.JSX.Element {
  return (
    <div className="tool-trace__detail overflow-hidden">
      <div
        className="border-b border-border-subtle last:border-b-0"
        role="log"
        aria-label="Tool input"
      >
        <ChatCodeBlock
          code={input.text}
          isStreaming={false}
          language={input.language}
          outputLabel="Input"
          showLineNumbers={false}
        />
      </div>
      <div role="log" aria-label="Tool output">
        <ChatCodeBlock
          code={output.text}
          isStreaming={false}
          language={output.language}
          outputLabel="Output"
          showLineNumbers={false}
        />
      </div>
    </div>
  )
}

export { GenericToolPayloadValueSchema, GenericToolTrace, formatGenericToolPayload }
