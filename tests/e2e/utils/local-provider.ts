import { once } from 'node:events'
import { createServer, type ServerResponse } from 'node:http'

import * as z from 'zod'

const RequestSchema = z.object({
  model: z.string(),
  stream: z.literal(true),
  messages: z.array(
    z
      .object({
        role: z.enum(['system', 'user', 'assistant', 'tool']),
        content: z.string().nullable(),
        tool_call_id: z.string().optional()
      })
      .passthrough()
  ),
  tools: z
    .array(
      z.object({
        type: z.literal('function'),
        function: z.object({ name: z.string() }).passthrough()
      })
    )
    .optional()
})
type ProviderRequest = z.infer<typeof RequestSchema>
const ToolInputSchema = z.record(z.string(), z.json())
type CompletionDelta = {
  reasoning_content?: string
  content?: string
  tool_calls?: Array<{
    index: number
    id?: string
    type?: 'function'
    function: { name?: string; arguments: string }
  }>
}
type Reply =
  | { type: 'text'; text: string; hold?: boolean }
  | { type: 'error'; status: number; retryAfter?: string }
  | {
      type: 'tool'
      name: string
      input: z.infer<typeof ToolInputSchema>
      id: string
      reasoning?: string
      holdArguments?: boolean
    }

function writeChunk(
  response: ServerResponse,
  delta: CompletionDelta,
  finishReason: string | null = null
): void {
  response.write(
    `data: ${JSON.stringify({ id: 'e2e-completion', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`
  )
}
function finish(response: ServerResponse): void {
  writeChunk(response, {}, 'stop')
  response.end('data: [DONE]\n\n')
}

/** Only the external model is scripted; Electron, HTTP parsing, tools, and storage stay real. */
export async function startLocalProvider() {
  const queue: Array<{
    reply: Reply
    received: (request: ProviderRequest) => void
    closed: () => void
    response?: ServerResponse
    finishArguments?: () => void
  }> = []
  const errors: string[] = []
  let requests: readonly ProviderRequest[] = []
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
        response.writeHead(404).end()
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = RequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      // Title generation is a separate background request, not a scripted user turn.
      if (
        body.messages.some(
          (message) =>
            message.role === 'system' &&
            message.content?.startsWith('You are a conversation title generator.')
        )
      ) {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        writeChunk(response, { content: 'E2E conversation' })
        finish(response)
        return
      }
      requests = [...requests, body]
      const entry = queue.shift()
      if (!entry) throw new Error('The application made an unscripted chat request.')
      entry.response = response
      response.on('close', entry.closed)
      entry.received(body)
      if (entry.reply.type === 'error') {
        response.setHeader('content-type', 'application/json')
        if (entry.reply.retryAfter) response.setHeader('retry-after', entry.reply.retryAfter)
        response.writeHead(entry.reply.status)
        response.end(JSON.stringify({ error: { message: 'E2E provider rejected the request.' } }))
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      if (entry.reply.type === 'tool') {
        if (entry.reply.reasoning)
          writeChunk(response, { reasoning_content: entry.reply.reasoning })
        writeChunk(response, {
          tool_calls: [
            {
              index: 0,
              id: entry.reply.id,
              type: 'function',
              function: { name: entry.reply.name, arguments: '' }
            }
          ]
        })
        const argumentsText = JSON.stringify(entry.reply.input)
        const prefix = argumentsText.slice(0, -1)
        for (let offset = 0; offset < prefix.length; offset += 7) {
          writeChunk(response, {
            tool_calls: [{ index: 0, function: { arguments: prefix.slice(offset, offset + 7) } }]
          })
        }
        entry.finishArguments = () => {
          writeChunk(response, {
            tool_calls: [{ index: 0, function: { arguments: argumentsText.slice(-1) } }]
          })
          writeChunk(response, {}, 'tool_calls')
          response.end('data: [DONE]\n\n')
        }
        if (!entry.reply.holdArguments) entry.finishArguments()
      } else {
        writeChunk(response, { content: entry.reply.text })
        if (!entry.reply.hold) finish(response)
      }
    })().catch((error) => {
      errors.push(error instanceof Error ? error.message : String(error))
      if (!response.headersSent) response.writeHead(500)
      response.end()
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = z.object({ port: z.number().int() }).parse(server.address())

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    modelId: 'e2e-model',
    errors,
    get requests(): readonly ProviderRequest[] {
      return requests
    },
    enqueue(reply: Reply) {
      const received = Promise.withResolvers<ProviderRequest>()
      const closed = Promise.withResolvers<void>()
      const entry: (typeof queue)[number] = {
        reply,
        received: received.resolve,
        closed: closed.resolve
      }
      queue.push(entry)
      return {
        received: received.promise,
        closed: closed.promise,
        finishArguments() {
          if (!entry.finishArguments) throw new Error('No tool argument stream to finish.')
          entry.finishArguments()
        },
        /** End HTTP cleanly without a native completion marker. */
        close() {
          const response = entry.response
          if (!response || response.destroyed)
            throw new Error('No active provider response to close.')
          response.end()
        },
        finish(text = '') {
          const response = entry.response
          if (!response || response.destroyed)
            throw new Error('No active provider response to finish.')
          if (text) writeChunk(response, { content: text })
          finish(response)
        }
      }
    },
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  }
}
