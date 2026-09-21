import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { ZodType } from 'zod'

import type { IpcChannel } from '@shared/IpcChannel'

type ChannelContext = { event: IpcMainInvokeEvent; window: BrowserWindow }
type ChannelDefinition<I, O> = {
  channel: IpcChannel
  /** When absent, the handler receives the raw renderer input for bespoke parsing. */
  input?: { schema: ZodType<I>; invalidMessage: string }
  handle: (input: I, context: ChannelContext) => O | Promise<O>
}

/**
 * Register one IPC invoke channel behind the shared trust and validation
 * template: the calling window is resolved and trusted first, then the raw
 * renderer input is parsed when the channel declares a schema. Handler and
 * validation errors propagate to the invoking renderer unchanged.
 */
function registerChannel<I, O>(
  registrar: Pick<IpcMain, 'handle'>,
  windowOf: (event: IpcMainInvokeEvent) => BrowserWindow,
  { channel, input, handle }: ChannelDefinition<I, O>
): void {
  registrar.handle(channel, (event, rawInput) => {
    const window = windowOf(event)
    if (!input) {
      // SAFETY: channels without a declared schema intentionally receive the raw
      // renderer input for bespoke parsing at the handler.
      return handle(rawInput as I, { event, window })
    }
    const result = input.schema.safeParse(rawInput)
    if (!result.success) throw new Error(input.invalidMessage)
    return handle(result.data, { event, window })
  })
}

export { registerChannel }
export type { ChannelContext, ChannelDefinition }
