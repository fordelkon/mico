import type { ZodType } from 'zod'

import { chatDataSchemas } from './chat'
import { AppearancePreferenceSchema, AppearanceSchema } from './preference'
import { providerDataSchemas } from './provider'
import { ThemePreferencesSchema, ThemeStateSchema } from './theme'
import {
  ExecutionProfileSnapshotSchema,
  PersistedSessionSchema,
  SessionIdSchema,
  SessionSummarySchema,
  SessionTitleSchema
} from './session'

const dataSchemas = {
  appearance: AppearanceSchema,
  appearancePreference: AppearancePreferenceSchema,
  executionProfileSnapshot: ExecutionProfileSnapshotSchema,
  persistedSession: PersistedSessionSchema,
  sessionId: SessionIdSchema,
  sessionSummary: SessionSummarySchema,
  sessionTitle: SessionTitleSchema,
  themePreferences: ThemePreferencesSchema,
  themeState: ThemeStateSchema,
  ...chatDataSchemas,
  ...providerDataSchemas
} satisfies Record<string, ZodType>
type DataSchemas = typeof dataSchemas
type DataSchema = keyof DataSchemas

export { dataSchemas, type DataSchema, type DataSchemas }
