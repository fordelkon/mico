import { execFile } from 'node:child_process'
import { relative, sep } from 'node:path'
import { stat } from 'node:fs/promises'
import { rgPath } from '@vscode/ripgrep'
import * as z from 'zod'

import { defineAgentTool, emitToolOutputDelta, type ToolExecutionContext } from './tool-contract'
import { resolveWorkspacePath } from './workspace-path-policy'

const GlobInputSchema = z.strictObject({
  pattern: z.string().min(1).max(4_096).describe('Glob pattern for filenames, e.g. **/*.ts.'),
  path: z
    .string()
    .min(1)
    .max(4_096)
    .optional()
    .describe('Directory inside the workspace to search. Defaults to the workspace.')
})
const GrepInputSchema = z.strictObject({
  pattern: z
    .string()
    .min(1)
    .max(4_096)
    .describe(
      'ripgrep regular expression. Escape regex metacharacters when searching literal text.'
    ),
  path: z
    .string()
    .min(1)
    .max(4_096)
    .optional()
    .describe('File or directory inside the workspace. Defaults to the workspace.'),
  glob: z.string().optional().describe('Filename filter, e.g. *.{ts,tsx}.'),
  type: z.string().optional().describe('ripgrep file type, e.g. js, py, rust.'),
  output_mode: z
    .enum(['content', 'files_with_matches', 'count'])
    .optional()
    .describe(
      'Default files_with_matches. content includes lines; count reports matching line counts per file.'
    ),
  '-i': z.boolean().optional().describe('Case-insensitive matching. Defaults to false.'),
  '-n': z.boolean().optional().describe('Show line numbers in content mode. Defaults to true.'),
  '-A': z.number().int().nonnegative().max(1_000).optional(),
  '-B': z.number().int().nonnegative().max(1_000).optional(),
  '-C': z.number().int().nonnegative().max(1_000).optional(),
  context: z
    .number()
    .int()
    .nonnegative()
    .max(1_000)
    .optional()
    .describe('Lines of context before and after each match.'),
  multiline: z
    .boolean()
    .optional()
    .describe('Allow matches across lines, including dot matching newlines.'),
  head_limit: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      'Maximum output entries, default 200. Zero disables pagination, within the output byte limit.'
    ),
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Number of output entries to skip. Defaults to zero.')
})

const MAX_SEARCH_OUTPUT_BYTES = 1024 * 1024

async function runSearch(args: string[], context: ToolExecutionContext): Promise<string[]> {
  context.signal.throwIfAborted()
  // Executables must live outside Electron's ASAR archive.
  const executable = rgPath.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      executable,
      ['--no-config', '--color', 'never', '--no-follow', ...args],
      {
        cwd: context.cwd,
        signal: context.signal,
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: MAX_SEARCH_OUTPUT_BYTES,
        encoding: 'utf8'
      },
      (error, stdout, stderr) => {
        if (error && error.code !== 1) {
          reject(
            new Error(
              `Search failed: ${stderr.trim() || error.message}. Narrow the path or pattern and retry.`
            )
          )
        } else resolve(stdout)
      }
    )
  })
  return output.trimEnd() ? output.trimEnd().split(/\r?\n/) : []
}

async function searchPath(
  path: string | undefined,
  context: ToolExecutionContext
): Promise<string> {
  const target = await resolveWorkspacePath(context.cwd, path ?? '.')
  return relative(context.cwd, target) || '.'
}

function publishSearch(output: string, context: ToolExecutionContext) {
  emitToolOutputDelta(context, { stream: 'preview', delta: output })
  return { output }
}

function createGlobTool() {
  return defineAgentTool({
    name: 'Glob',
    description:
      'Find workspace files by glob pattern. Returns filenames sorted by modification time, newest first. Respects ignore files; does not follow symlinks. Results are bounded to 200 paths. Use Grep to search file contents.',
    inputSchema: GlobInputSchema,
    isConcurrencySafe: () => true,
    isReadOnly: () => true,
    async execute({ pattern, path }, context) {
      const target = await searchPath(path, context)
      const resolved = await resolveWorkspacePath(context.cwd, target)
      if (!(await stat(resolved)).isDirectory())
        throw new Error('Glob path must be a directory. Use Grep or Read for a file.')
      const files = await runSearch(
        ['--files', '--sortr', 'modified', '--glob', pattern, '--', target],
        context
      )
      const visible = files
        .slice(0, 200)
        .map((file) => file.split(sep).join('/').replace(/^\.\//, ''))
      return publishSearch(
        [
          `Found ${files.length} file(s).`,
          ...visible,
          ...(files.length > 200 ? ['Results truncated. Narrow path or pattern.'] : [])
        ].join('\n'),
        context
      )
    }
  })
}

function createGrepTool() {
  return defineAgentTool({
    name: 'Grep',
    description:
      'Search workspace contents with ripgrep regular expressions. pattern is required. Defaults to case-sensitive filenames-only results; use output_mode="content" for matching lines or "count" for counts. Respects ignore files, skips binary files and does not follow symlinks. Invalid regex, glob or file types return errors. Output is bounded to 1 MiB.',
    inputSchema: GrepInputSchema,
    isConcurrencySafe: () => true,
    isReadOnly: () => true,
    async execute(input, context) {
      const mode = input.output_mode ?? 'files_with_matches'
      const args = ['--sort', 'path', '--with-filename', '--no-heading']
      if (mode === 'files_with_matches') args.push('--files-with-matches')
      if (mode === 'count') args.push('--count')
      if (mode === 'content') {
        args.push(input['-n'] === false ? '--no-line-number' : '--line-number')
        const surrounding = input.context ?? input['-C']
        if (surrounding !== undefined) args.push('--context', String(surrounding))
        if (input['-A'] !== undefined) args.push('--after-context', String(input['-A']))
        if (input['-B'] !== undefined) args.push('--before-context', String(input['-B']))
      }
      if (input['-i']) args.push('--ignore-case')
      if (input.multiline) args.push('--multiline', '--multiline-dotall')
      if (input.glob !== undefined) args.push('--glob', input.glob)
      if (input.type !== undefined) args.push('--type', input.type)
      args.push('--regexp', input.pattern, '--', await searchPath(input.path, context))
      const lines = await runSearch(args, context)
      const offset = input.offset ?? 0
      const limit = input.head_limit ?? 200
      const visible = lines.slice(offset, limit === 0 ? undefined : offset + limit)
      const summary =
        lines.length === 0
          ? 'No matches found.'
          : visible.length === 0
            ? 'No entries at this offset.'
            : `Found ${lines.length} result(s).`
      const total =
        mode === 'count'
          ? lines.reduce((sum, line) => sum + Number(line.slice(line.lastIndexOf(':') + 1)), 0)
          : undefined
      return publishSearch(
        [
          summary,
          ...visible,
          ...(total !== undefined ? [`Total matching lines: ${total}.`] : []),
          ...(offset + visible.length < lines.length
            ? ['More results available. Increase head_limit or offset.']
            : [])
        ].join('\n'),
        context
      )
    }
  })
}

export { createGlobTool, createGrepTool }
