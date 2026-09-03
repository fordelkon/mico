import * as z from 'zod'

import {
  ModelDisplayNameSchema,
  ModelEntryIdSchema,
  ProviderConfigurationSchema,
  ProviderIdSchema,
  ProviderLibrarySchema,
  ProviderModelIdSchema
} from '../../data/schemas/provider'
import type {
  ModelEntry,
  ProviderConfiguration,
  ProviderId,
  ProviderLibrary
} from '../../data/schemas/provider'
import { defineRoute } from '../define'

const DiscoveredModelSchema = z.object({
  modelId: ProviderModelIdSchema,
  displayName: ModelDisplayNameSchema
})
const ImportModelRequestSchema = z.object({
  provider: ProviderIdSchema,
  modelId: ProviderModelIdSchema,
  displayName: ModelDisplayNameSchema
})
const AddModelRequestSchema = z.object({
  provider: ProviderIdSchema,
  modelId: ProviderModelIdSchema,
  displayName: ModelDisplayNameSchema.optional()
})

interface ProvidersAPI {
  getLibrary: () => Promise<ProviderLibrary>
  saveConfiguration: (configuration: ProviderConfiguration) => Promise<ProviderLibrary>
  discoverModels: (configuration: ProviderConfiguration) => Promise<DiscoveredModel[]>
  importModel: (model: ImportModelRequest) => Promise<ProviderLibrary>
  addModel: (model: AddModelRequest) => Promise<ProviderLibrary>
  removeModel: (modelId: string) => Promise<ProviderLibrary>
  selectModel: (modelId: string | null) => Promise<ProviderLibrary>
}

const providersRequestSchemas = {
  'providers.add-model': defineRoute({
    input: AddModelRequestSchema,
    output: ProviderLibrarySchema
  }),
  'providers.discover-models': defineRoute({
    input: ProviderConfigurationSchema,
    output: z.array(DiscoveredModelSchema)
  }),
  'providers.get-library': defineRoute({ input: z.void(), output: ProviderLibrarySchema }),
  'providers.import-model': defineRoute({
    input: ImportModelRequestSchema,
    output: ProviderLibrarySchema
  }),
  'providers.remove-model': defineRoute({
    input: ModelEntryIdSchema,
    output: ProviderLibrarySchema
  }),
  'providers.save-configuration': defineRoute({
    input: ProviderConfigurationSchema,
    output: ProviderLibrarySchema
  }),
  'providers.select-model': defineRoute({
    input: ModelEntryIdSchema.nullable(),
    output: ProviderLibrarySchema
  })
}

type AddModelRequest = z.infer<typeof AddModelRequestSchema>
type DiscoveredModel = z.infer<typeof DiscoveredModelSchema>
type ImportModelRequest = z.infer<typeof ImportModelRequestSchema>

export {
  AddModelRequestSchema,
  DiscoveredModelSchema,
  ImportModelRequestSchema,
  providersRequestSchemas,
  type ProvidersAPI
}
export type {
  AddModelRequest,
  DiscoveredModel,
  ImportModelRequest,
  ModelEntry,
  ProviderConfiguration,
  ProviderId,
  ProviderLibrary
}
