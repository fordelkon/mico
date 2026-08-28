import type { ZodType } from 'zod'

interface RouteDef {
  input: ZodType
  output: ZodType
}

function defineRoute<D extends RouteDef>(definition: D): D {
  return definition
}

export { defineRoute, type RouteDef }
