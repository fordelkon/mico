import type { ZodType } from 'zod'

import {
  ChatMessageSchema,
  ModelReasoningCapabilitiesSchema,
  ExecutionProfileSnapshotSchema,
  PersistedSessionSchema,
  SessionIdSchema,
  SessionSummarySchema,
  SessionTitleSchema
} from '@mico/coding-agent/contracts'
import { AppearancePreferenceSchema, AppearanceSchema } from './preference'
import { providerDataSchemas } from './provider'
import { ThemePreferencesSchema, ThemeStateSchema } from './theme'

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
  chatMessage: ChatMessageSchema,
  modelReasoningCapabilities: ModelReasoningCapabilitiesSchema,
  ...providerDataSchemas
} satisfies Record<string, ZodType>
type DataSchemas = typeof dataSchemas
type DataSchema = keyof DataSchemas

export { dataSchemas, type DataSchema, type DataSchemas }
