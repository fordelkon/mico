import * as z from 'zod'
import { PermissionResponseSchema } from '../ai/permissions'
import {
  SkillCatalogRequestSchema,
  SkillCatalogSchema,
  SkillDocumentRequestSchema,
  SkillDocumentSchema
} from '../ai/skills'
import { ModelReasoningCapabilitiesSchema, ThinkingSelectionSchema } from '../data/schemas/chat'
import { AppearancePreferenceSchema } from '../data/schemas/preference'
import {
  ModelEntryIdSchema,
  ModelEntrySchema,
  ProviderConfigurationSchema,
  ProviderLibrarySchema
} from '../data/schemas/provider'
import {
  PersistedSessionSchema,
  ProjectIdSchema,
  SessionIdSchema,
  SessionSummarySchema,
  SessionTitleSchema
} from '../data/schemas/session'
import { ThemePreferencesSchema, ThemeStateSchema } from '../data/schemas/theme'
import { WorkspaceProjectSchema } from '../data/schemas/workspace'
import { IpcChannel } from '../IpcChannel'
import { CodeDocumentPartsSchema } from './schemas/attachments'
import { TurnRequestIdSchema, TurnStartRequestSchema } from './schemas/chat'
import {
  AddModelRequestSchema,
  DiscoveredModelSchema,
  SyncModelsRequestSchema,
  TestModelRequestSchema
} from './schemas/providers'
import { CreateSessionRequestSchema } from './schemas/sessions'

const empty = z.undefined()
const completion = z.void()

/** One canonical request and result contract for each renderer invoke task. */
const taskSchemas = {
  [IpcChannel.Skills_List]: { input: SkillCatalogRequestSchema, output: SkillCatalogSchema },
  [IpcChannel.Skills_ReadDocument]: {
    input: SkillDocumentRequestSchema,
    output: SkillDocumentSchema
  },
  [IpcChannel.WindowControls_Close]: { input: empty, output: completion },
  [IpcChannel.WindowControls_IsFocused]: { input: empty, output: z.boolean() },
  [IpcChannel.WindowControls_IsFullscreen]: { input: empty, output: z.boolean() },
  [IpcChannel.WindowControls_IsMaximized]: { input: empty, output: z.boolean() },
  [IpcChannel.WindowControls_Maximize]: { input: empty, output: completion },
  [IpcChannel.WindowControls_Minimize]: { input: empty, output: completion },
  [IpcChannel.WindowControls_ToggleFullscreen]: { input: empty, output: completion },
  [IpcChannel.WindowControls_Unmaximize]: { input: empty, output: completion },
  [IpcChannel.Appearance_SetPreference]: {
    input: AppearancePreferenceSchema,
    output: ThemeStateSchema
  },
  [IpcChannel.Appearance_GetThemeState]: { input: empty, output: ThemeStateSchema },
  [IpcChannel.Appearance_SetThemePreferences]: {
    input: ThemePreferencesSchema,
    output: ThemeStateSchema
  },
  [IpcChannel.Attachments_PickCodeDocuments]: { input: empty, output: CodeDocumentPartsSchema },
  [IpcChannel.Chat_StartTurn]: { input: TurnStartRequestSchema, output: completion },
  [IpcChannel.Chat_GetSkillCatalog]: {
    input: SkillCatalogRequestSchema,
    output: SkillCatalogSchema
  },
  [IpcChannel.Chat_GetCapabilities]: {
    input: SessionIdSchema.optional(),
    output: ModelReasoningCapabilitiesSchema.nullable()
  },
  [IpcChannel.Chat_RespondToPermission]: { input: PermissionResponseSchema, output: completion },
  [IpcChannel.Chat_AbortTurn]: { input: TurnRequestIdSchema, output: completion },
  [IpcChannel.Sessions_List]: { input: empty, output: z.array(SessionSummarySchema) },
  [IpcChannel.Sessions_Create]: { input: CreateSessionRequestSchema, output: SessionSummarySchema },
  [IpcChannel.Sessions_Delete]: { input: SessionIdSchema, output: completion },
  [IpcChannel.Sessions_Load]: { input: SessionIdSchema, output: PersistedSessionSchema },
  [IpcChannel.Sessions_Rename]: {
    input: z.object({ sessionId: SessionIdSchema, title: SessionTitleSchema }),
    output: SessionSummarySchema
  },
  [IpcChannel.Sessions_SetThinkingEffort]: {
    input: z.object({ sessionId: SessionIdSchema, thinkingEffort: ThinkingSelectionSchema }),
    output: completion
  },
  [IpcChannel.Sessions_SetModelEntry]: {
    input: z.object({ sessionId: SessionIdSchema, modelEntryId: ModelEntryIdSchema }),
    output: completion
  },
  [IpcChannel.Workspaces_List]: { input: empty, output: z.array(WorkspaceProjectSchema) },
  [IpcChannel.Workspaces_AddFromDialog]: {
    input: empty,
    output: WorkspaceProjectSchema.optional()
  },
  [IpcChannel.Workspaces_SetDefault]: { input: ProjectIdSchema, output: WorkspaceProjectSchema },
  [IpcChannel.Workspaces_Rename]: {
    input: z.object({ projectId: ProjectIdSchema, name: SessionTitleSchema }),
    output: WorkspaceProjectSchema
  },
  [IpcChannel.Workspaces_Reveal]: { input: ProjectIdSchema, output: completion },
  [IpcChannel.Workspaces_Archive]: { input: ProjectIdSchema, output: completion },
  [IpcChannel.Providers_GetLibrary]: { input: empty, output: ProviderLibrarySchema },
  [IpcChannel.Providers_SaveLibrary]: {
    input: ProviderLibrarySchema,
    output: ProviderLibrarySchema
  },
  [IpcChannel.Providers_DiscoverModels]: {
    input: ProviderConfigurationSchema,
    output: z.array(DiscoveredModelSchema)
  },
  [IpcChannel.Providers_SyncModels]: { input: SyncModelsRequestSchema, output: completion },
  [IpcChannel.Providers_AddModel]: { input: AddModelRequestSchema, output: ModelEntrySchema },
  [IpcChannel.Providers_TestModel]: { input: TestModelRequestSchema, output: completion }
}

type InvokeChannel = keyof typeof taskSchemas
type IpcInput<C extends InvokeChannel> = z.output<(typeof taskSchemas)[C]['input']>
type IpcOutput<C extends InvokeChannel> = z.output<(typeof taskSchemas)[C]['output']>
type IpcArgs<C extends InvokeChannel> =
  IpcInput<C> extends undefined
    ? []
    : undefined extends IpcInput<C>
      ? [input?: IpcInput<C>]
      : [input: IpcInput<C>]
type IpcMethod<C extends InvokeChannel> = (...args: IpcArgs<C>) => Promise<IpcOutput<C>>

// Preserve channel correlation when indexing a heterogeneous schema map.
type IpcContracts = {
  [C in InvokeChannel]: { input: z.ZodType<IpcInput<C>>; output: z.ZodType<IpcOutput<C>> }
}
const ipcContracts: IpcContracts = taskSchemas

function inputSchema<C extends InvokeChannel>(channel: C): z.ZodType<IpcInput<C>> {
  return ipcContracts[channel].input
}

function outputSchema<C extends InvokeChannel>(channel: C): z.ZodType<IpcOutput<C>> {
  return ipcContracts[channel].output
}

export {
  type InvokeChannel,
  type IpcArgs,
  type IpcInput,
  type IpcMethod,
  type IpcOutput,
  inputSchema,
  outputSchema
}
