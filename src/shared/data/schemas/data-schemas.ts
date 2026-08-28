import type { ZodType } from 'zod'

import { AppearancePreferenceSchema, AppearanceSchema } from './preference'

const dataSchemas = {
  appearance: AppearanceSchema,
  appearancePreference: AppearancePreferenceSchema
} satisfies Record<string, ZodType>
type DataSchemas = typeof dataSchemas
type DataSchema = keyof DataSchemas

export { dataSchemas, type DataSchema, type DataSchemas }
