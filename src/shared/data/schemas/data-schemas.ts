import type { ZodType } from 'zod'

import { chatDataSchemas } from './chat'
import { AppearancePreferenceSchema, AppearanceSchema } from './preference'
import { providerDataSchemas } from './provider'

const dataSchemas = {
  appearance: AppearanceSchema,
  appearancePreference: AppearancePreferenceSchema,
  ...chatDataSchemas,
  ...providerDataSchemas
} satisfies Record<string, ZodType>
type DataSchemas = typeof dataSchemas
type DataSchema = keyof DataSchemas

export { dataSchemas, type DataSchema, type DataSchemas }
