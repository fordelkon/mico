import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import * as z from 'zod'

import {
  DEFAULT_BASH_TIMEOUT_MS,
  defineAgentTool,
  emitToolOutputDelta,
  MAX_BASH_OUTPUT_BYTES,
  type AgentTool,
  type ToolExecutionContext
} from './tool-contract'

const BashInputSchema = z.strictObject({
  command: z
    .string()
    .min(1)
    .max(64 * 1024),
  timeout: z
    .number()
    .positive()
    .finite()
    .optional()
    .describe('Timeout in milliseconds. Default 120000; capped at 600000.'),
  description: z.string().optional().describe('Short description of what this command does.'),
  run_in_background: z
    .literal(false)
    .optional()
    .describe('Only foreground execution is supported. Omit or set false.')
})
type BashInput = z.infer<typeof BashInputSchema>

// Segments classified by their leading program. A compound command is
// read-only only when EVERY segment is in the read sets (or the neutral set,
// whose members have no side effects but do not make a command a read).
// Anything unclassifiable — including any redirect — fails closed to serial.
const BASH_SEARCH_SEGMENTS = new Set(['grep', 'rg', 'find', 'fd'])
const BASH_READ_SEGMENTS = new Set(['cat', 'head', 'tail', 'wc', 'jq', 'file', 'stat'])
const BASH_LIST_SEGMENTS = new Set(['ls', 'tree', 'du', 'df'])
const BASH_NEUTRAL_SEGMENTS = new Set(['echo', 'printf'])
// git is writable overall, but these read-only subcommands are common in agent turns.
const BASH_GIT_READ_SUBCOMMANDS = new Set(['status', 'log', 'diff', 'show', 'ls-files'])

/**
 * Concurrency-safety classification for a bash command. Splitting is plain and
 * conservative: quoted operators over-split, which lands unknown segments in
 * the serial bucket — a performance loss, never a safety one.
 */
function isReadOnlyBashCommand(command: string): boolean {
  // Any redirect writes, wherever it appears in a segment.
  if (/[<>]/.test(command)) return false
  const segments = command.split(/&&|\|\||[;|\n]/)
  return segments.every((segment) => {
    const program = segment.trim().split(/\s+/).filter(Boolean)[0]
    if (!program) return false
    if (BASH_SEARCH_SEGMENTS.has(program)) return true
    if (BASH_READ_SEGMENTS.has(program)) return true
    if (BASH_LIST_SEGMENTS.has(program)) return true
    if (BASH_NEUTRAL_SEGMENTS.has(program)) return true
    if (program === 'git') {
      const subcommand = segment.trim().split(/\s+/).filter(Boolean)[1]
      return subcommand !== undefined && BASH_GIT_READ_SUBCOMMANDS.has(subcommand)
    }
    return false
  })
}
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
  timeoutMs: number,
  context: ToolExecutionContext
): Promise<string> {
  const { cwd, signal } = context
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
    const append = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
      const remainingBytes = MAX_BASH_OUTPUT_BYTES - Buffer.byteLength(output)
      if (remainingBytes <= 0) return
      const text = chunk.subarray(0, remainingBytes).toString()
      output += text
      emitToolOutputDelta(context, { stream, delta: text })
    }
    let termination: Promise<void> | undefined
    const terminate = () => (termination ??= terminateProcessTree(child))
    const stop = () => {
      if (settled || aborted || timedOut) return
      aborted = true
      void terminate().then(() => settle(() => reject(new Error('Command aborted'))))
    }
    timeout = setTimeout(() => {
      if (settled || aborted || timedOut) return
      timedOut = true
      void terminate().then(() =>
        settle(() => reject(new Error(`Command timed out after ${timeoutMs} milliseconds`)))
      )
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk))
    child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk))
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

/**
 * Kill descendants too: a shell can exit while a command it launched keeps running.
 * Waits for the direct child's exit as well as the Windows taskkill request, with
 * a deadline for unresponsive processes. Inherited pipe handles must not delay
 * cancellation.
 */
async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid) {
    try {
      await once(child, 'spawn')
    } catch {
      return
    }
  }
  // Subscribe before killing: the target can exit before the killer does.
  const exited = boundedExit(child)
  if (process.platform !== 'win32') {
    child.kill()
    await exited
    return
  }
  const killer = spawn('taskkill.exe', ['/f', '/t', '/pid', String(child.pid)], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  await boundedExit(killer)
  if (killer.exitCode !== 0 && child.exitCode === null && child.signalCode === null) child.kill()
  // taskkill can exit while TerminateProcess is still releasing the target's cwd.
  await exited
}

/** A kill that never confirms must not hang cancellation or retain listeners. */
function boundedExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      child.removeListener('exit', finish)
      child.removeListener('error', finish)
      resolve()
    }
    const timer = setTimeout(finish, 5_000)
    timer.unref()
    child.once('exit', finish)
    child.once('error', finish)
  })
}

function createBashTool(): AgentTool<BashInput> {
  return defineAgentTool({
    name: 'Bash',
    description:
      'Execute a foreground shell command starting in the project workspace. timeout is in milliseconds. Background tasks are not supported. This tool is not sandboxed.',
    isConcurrencySafe: ({ command }) => isReadOnlyBashCommand(command),
    inputSchema: BashInputSchema,
    operation: () => ({ kind: 'command' }),
    async execute({ command, timeout }, context) {
      return {
        output: await executeShell(
          command,
          Math.min(timeout ?? DEFAULT_BASH_TIMEOUT_MS, 600_000),
          context
        )
      }
    }
  })
}

export { createBashTool }
