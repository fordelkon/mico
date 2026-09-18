import { spawn } from 'node:child_process'

import * as z from 'zod'

import {
  DEFAULT_BASH_TIMEOUT_SECONDS,
  MAX_BASH_OUTPUT_BYTES,
  type AgentTool,
  type ToolExecutionContext
} from './tool-contract'

const BashInputSchema = z.object({
  command: z
    .string()
    .min(1)
    .max(64 * 1024),
  timeout: z.number().positive().finite().max(300).optional()
})
type BashInput = z.infer<typeof BashInputSchema>

function truncateOutput(output: string): string {
  if (Buffer.byteLength(output) <= MAX_BASH_OUTPUT_BYTES) return output || '(no output)'
  return `${Buffer.from(output).subarray(-MAX_BASH_OUTPUT_BYTES).toString()}\n\n[Output truncated.]`
}

function executeShell(
  command: string,
  timeoutSeconds: number,
  { cwd, signal }: ToolExecutionContext
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Command aborted'))
    const windows = process.platform === 'win32'
    const shell = windows ? (process.env.ComSpec ?? 'cmd.exe') : (process.env.SHELL ?? '/bin/sh')
    const args = windows ? ['/d', '/s', '/c', command] : ['-lc', command]
    const child = spawn(shell, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let aborted = false
    let timedOut = false
    const append = (chunk: Buffer) => {
      if (Buffer.byteLength(output) < MAX_BASH_OUTPUT_BYTES) output += chunk.toString()
    }
    const stop = () => {
      aborted = true
      child.kill()
    }
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutSeconds * 1_000)
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.once('error', (error) => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', stop)
      reject(error)
    })
    child.once('close', (exitCode) => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', stop)
      if (aborted) return reject(new Error('Command aborted'))
      if (timedOut) return reject(new Error(`Command timed out after ${timeoutSeconds} seconds`))
      if (exitCode !== 0)
        return reject(new Error(`Command exited with code ${exitCode ?? 'unknown'}`))
      resolve(truncateOutput(output))
    })
    signal.addEventListener('abort', stop, { once: true })
  })
}

function createBashTool(): AgentTool<BashInput> {
  return {
    definition: {
      name: 'bash',
      description:
        'Execute a local shell command starting in the project workspace. This tool is not sandboxed.',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          timeout: { type: 'number', exclusiveMinimum: 0, maximum: 300 }
        },
        required: ['command'],
        additionalProperties: false
      }
    },
    inputSchema: BashInputSchema,
    async execute({ command, timeout }, context) {
      return {
        output: await executeShell(command, timeout ?? DEFAULT_BASH_TIMEOUT_SECONDS, context)
      }
    }
  }
}

export { createBashTool }
