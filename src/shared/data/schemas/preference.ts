import * as z from 'zod'

import { defineSchema } from '../define'

const AppearanceSchema = defineSchema(z.enum(['light', 'dark']))
const AppearancePreferenceSchema = defineSchema(z.enum(['system', 'light', 'dark']))

export { AppearancePreferenceSchema, AppearanceSchema }
