import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import * as z from 'zod'

import {
  DEFAULT_BASH_TIMEOUT_SECONDS,
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
  timeout: z.number().positive().finite().max(300).optional()
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
  timeoutSeconds: number,
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
    const stop = () => {
      aborted = true
      void terminateProcessTree(child).then(() =>
        settle(() => reject(new Error('Command aborted')))
      )
    }
    timeout = setTimeout(() => {
      timedOut = true
      void terminateProcessTree(child).then(() =>
        settle(() => reject(new Error(`Command timed out after ${timeoutSeconds} seconds`)))
      )
    }, timeoutSeconds * 1_000)
    // Abort can win the race with OS process creation. Retrying after `spawn`
    // closes that gap; otherwise a Windows taskkill issued before the PID exists
    // succeeds nowhere and the command can outlive the cancelled agent turn.
    child.once('spawn', () => {
      if (aborted || timedOut) void terminateProcessTree(child)
    })
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
 * Resolves once the kill is confirmed (direct child on Unix, the taskkill killer on
 * Windows) so a cancelled turn is not reported finished while its process tree is
 * still dying. Waiting for the process, not the pipes: inherited pipe handles must
 * never delay cancellation.
 */
async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return
  if (process.platform !== 'win32') {
    child.kill()
    await boundedExit(child)
    return
  }
  const killer = spawn('taskkill.exe', ['/f', '/t', '/pid', String(child.pid)], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  killer.once('error', () => child.kill())
  await boundedExit(killer)
}

/** A kill that never confirms must not hang cancellation. */
async function boundedExit(process: ChildProcess): Promise<void> {
  const confirmed = once(process, 'exit').then(
    () => undefined,
    () => undefined
  )
  const deadline = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 5_000)
    timer.unref()
  })
  await Promise.race([confirmed, deadline])
}

function createBashTool(): AgentTool<BashInput> {
  return defineAgentTool({
    name: 'bash',
    description:
      'Execute a local shell command starting in the project workspace. This tool is not sandboxed.',
    isConcurrencySafe: ({ command }) => isReadOnlyBashCommand(command),
    inputSchema: BashInputSchema,
    async execute({ command, timeout }, context) {
      return {
        output: await executeShell(command, timeout ?? DEFAULT_BASH_TIMEOUT_SECONDS, context)
      }
    }
  })
}

export { createBashTool, isReadOnlyBashCommand }
