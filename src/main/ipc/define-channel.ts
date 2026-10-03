import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import * as z from 'zod'

import {
  inputSchema,
  outputSchema,
  type InvokeChannel,
  type IpcInput,
  type IpcOutput
} from '@shared/ipc/contracts'

type ChannelContext = { event: IpcMainInvokeEvent; window: BrowserWindow }
type ChannelDefinition<C extends InvokeChannel> = {
  channel: C
  invalidMessage?: string
  handle: (
    input: NoInfer<IpcInput<C>>,
    context: ChannelContext
  ) => NoInfer<IpcOutput<C>> | Promise<NoInfer<IpcOutput<C>>>
}

/**
 * Register one IPC invoke channel behind the shared trust and validation
 * template: the calling window is resolved and trusted first, then the raw
 * renderer input and handler result are parsed through the channel's shared
 * contract. Domain execution remains in the owning module.
 */
function registerChannel<C extends InvokeChannel>(
  registrar: Pick<IpcMain, 'handle'>,
  windowOf: (event: IpcMainInvokeEvent) => BrowserWindow,
  { channel, invalidMessage, handle }: ChannelDefinition<C>
): void {
  registrar.handle(channel, (event, rawInput) => {
    const window = windowOf(event)
    const parsed = z.safeParse(inputSchema(channel), rawInput)
    if (!parsed.success) throw new Error(invalidMessage ?? `Invalid request for ${channel}`)
    const parseResult = (result: IpcOutput<C>): IpcOutput<C> => {
      const output = z.safeParse(outputSchema(channel), result)
      if (!output.success)
        throw new Error(`Invalid response for ${channel}. Restart the application and try again.`)
      return output.data
    }
    const result = handle(parsed.data, { event, window })
    return result instanceof Promise ? result.then(parseResult) : parseResult(result)
  })
}

export { registerChannel }
export type { ChannelContext, ChannelDefinition }
