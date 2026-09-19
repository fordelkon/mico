import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

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
type ShellConfig = { executable: string; arguments: string[] }

/**
 * Pi treats shell selection as an operating-system concern, not a model concern.
 * We keep the same principle in a much smaller form: prefer a real bash on Windows
 * (Git Bash is the usual installation), then fall back to cmd; Unix uses the user's
 * shell. The tool contract stays one command string on every platform.
 */
function getShellConfig(): ShellConfig {
  if (process.platform !== 'win32')
    return { executable: process.env.SHELL ?? '/bin/sh', arguments: ['-lc'] }

  const gitBashPaths = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
    .filter((directory): directory is string => Boolean(directory))
    .map((directory) => join(directory, 'Git', 'bin', 'bash.exe'))
  const gitBash = gitBashPaths.find(existsSync)
  if (gitBash) return { executable: gitBash, arguments: ['-lc'] }

  return { executable: process.env.ComSpec ?? 'cmd.exe', arguments: ['/d', '/s', '/c'] }
}

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
    const shell = getShellConfig()
    const child = spawn(shell.executable, [...shell.arguments, command], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    let output = ''
    let aborted = false
    let timedOut = false
    let settled = false
    let timeout: NodeJS.Timeout | undefined
    const append = (chunk: Buffer) => {
      if (Buffer.byteLength(output) < MAX_BASH_OUTPUT_BYTES) output += chunk.toString()
    }
    const stop = () => {
      aborted = true
      terminateProcessTree(child)
      settle(() => reject(new Error('Command aborted')))
    }
    timeout = setTimeout(() => {
      timedOut = true
      terminateProcessTree(child)
      settle(() => reject(new Error(`Command timed out after ${timeoutSeconds} seconds`)))
    }, timeoutSeconds * 1_000)
    // Abort can win the race with OS process creation. Retrying after `spawn`
    // closes that gap; otherwise a Windows taskkill issued before the PID exists
    // succeeds nowhere and the command can outlive the cancelled agent turn.
    child.once('spawn', () => {
      if (aborted || timedOut) terminateProcessTree(child)
    })
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.once('error', (error) => {
      settle(() => reject(error))
    })
    child.once('close', (exitCode) => {
      if (aborted || timedOut) return
      if (exitCode !== 0)
        return settle(() => reject(new Error(`Command exited with code ${exitCode ?? 'unknown'}`)))
      settle(() => resolve(truncateOutput(output)))
    })
    signal.addEventListener('abort', stop, { once: true })

    /** A cancelled turn must not wait for inherited pipe handles to close. */
    function settle(action: () => void): void {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      signal.removeEventListener('abort', stop)
      action()
    }
  })
}

/** Kill descendants too: a shell can exit while a command it launched keeps running. */
function terminateProcessTree(child: ReturnType<typeof spawn>): void {
  if (!child.pid) return
  if (process.platform !== 'win32') {
    child.kill()
    return
  }
  const killer = spawn('taskkill.exe', ['/f', '/t', '/pid', String(child.pid)], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  killer.once('error', () => child.kill())
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
