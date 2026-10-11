import * as z from 'zod'

// Keep field diagnostics without retaining provider payloads, which can contain
// conversation content or credentials echoed by a gateway.
function parseEvent<T extends z.ZodType>(schema: T, provider: string, data: string): z.output<T> {
  const describe = (reason: string) =>
    `The ${provider} streaming response contained invalid event data: ${reason}.`
  let value: unknown
  try {
    value = JSON.parse(data)
  } catch {
    throw new Error(describe('JSON parse failed'))
  }
  const result = schema.safeParse(value)
  if (!result.success) {
    const issue = result.error.issues[0]
    const location = issue && issue.path.length > 0 ? issue.path.join('.') : '(root)'
    throw new Error(describe(`schema validation failed at ${location}`))
  }
  return result.data
}

export { parseEvent }
