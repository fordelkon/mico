import type { ZodType } from 'zod'

function defineSchema<S extends ZodType>(schema: S): S {
  return schema
}

export { defineSchema }
