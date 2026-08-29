import * as z from 'zod'

import { AppearancePreferenceSchema, AppearanceSchema } from '../../data/schemas/preference'
import type { DataFor } from '../../data/types'
import { defineRoute } from '../define'

type Appearance = DataFor<'appearance'>
type AppearancePreference = DataFor<'appearancePreference'>

interface AppearanceAPI {
  getPreference: () => Promise<AppearancePreference>
  getResolvedAppearance: () => Promise<Appearance>
  onAppearanceChange: (listener: (appearance: Appearance) => void) => () => void
  setPreference: (preference: AppearancePreference) => Promise<Appearance>
}
const appearanceRequestSchemas = {
  'appearance.get-preference': defineRoute({ input: z.void(), output: AppearancePreferenceSchema }),
  'appearance.get-resolved': defineRoute({ input: z.void(), output: AppearanceSchema }),
  'appearance.set-preference': defineRoute({
    input: AppearancePreferenceSchema,
    output: AppearanceSchema
  })
}
export { appearanceRequestSchemas, type AppearanceAPI }
