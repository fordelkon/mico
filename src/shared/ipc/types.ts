import type * as z from 'zod'

import type { IpcRequestSchemas, IpcRoute } from './schemas/ipc-schemas'

type InputFor<Route extends IpcRoute> = z.infer<IpcRequestSchemas[Route]['input']>
type OutputFor<Route extends IpcRoute> = z.infer<IpcRequestSchemas[Route]['output']>

export type { InputFor, OutputFor }
