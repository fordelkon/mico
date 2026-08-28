import type * as z from 'zod'

import type { DataSchema, DataSchemas } from './schemas/data-schemas'

type DataFor<Schema extends DataSchema> = z.infer<DataSchemas[Schema]>

export type { DataFor }
