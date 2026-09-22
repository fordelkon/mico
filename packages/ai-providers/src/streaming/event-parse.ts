import * as z from 'zod'

const snippetLength = 200

function snippet(data: string): string {
  return data.length > snippetLength ? `${data.slice(0, snippetLength)}…` : data
}

// Compatible servers emit event shapes the schema does not model. Name the
// first validation failure and include a data snippet so the offending event
// can be identified from the error alone instead of requiring a wire capture.
function parseEvent<T extends z.ZodType>(schema: T, provider: string, data: string): z.output<T> {
  const describe = (reason: string) =>
    `The ${provider} streaming response contained invalid event data: ${reason}.`
  let value: unknown
  try {
    value = JSON.parse(data)
  } catch {
    throw new Error(describe(`JSON parse failed for ${snippet(data)}`))
  }
  const result = schema.safeParse(value)
  if (!result.success) {
    const issue = result.error.issues[0]
    const location = issue && issue.path.length > 0 ? issue.path.join('.') : '(root)'
    throw new Error(
      describe(`${issue?.message ?? 'unknown reason'} at ${location} in ${snippet(data)}`)
    )
  }
  return result.data
}

export { parseEvent }
