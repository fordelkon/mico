import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readlink, realpath, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Adapted from delkon.us.kg/.claude/hooks/context.mjs; keep canonical path handling.
const scriptRoot = fileURLToPath(new URL('../../', import.meta.url))
const root = await realpath(process.env.CLAUDE_PROJECT_DIR || scriptRoot)
process.stdin.setEncoding('utf8')
let rawInput = ''
for await (const chunk of process.stdin) rawInput += chunk
const input = JSON.parse(rawInput)
const filePath = input.tool_input?.file_path

if (['Read', 'Edit', 'Write'].includes(input.tool_name) && typeof filePath === 'string') {
  const requested = path.resolve(input.cwd || root, filePath)
  const resolved = await resolveNewPath(requested)
  const relative = path.relative(root, resolved).split(path.sep).join('/')
  if (relative !== '..' && !relative.startsWith('../') && !path.isAbsolute(relative)) {
    const documents = []
    if (
      relative.startsWith('.claude/hooks/') ||
      relative.startsWith('.agents/skills/') ||
      ['AGENTS.md', 'CLAUDE.md'].includes(relative) ||
      relative.startsWith('docs/agent-')
    ) {
      documents.push('docs/agent-context-loading.md', 'docs/agent-guide.md')
    }
    if (
      relative.startsWith('src/') ||
      relative.startsWith('packages/') ||
      relative.startsWith('build/') ||
      /^(?:[^/]+\.config\.[^/]+|tsconfig[^/]*\.json|package\.json|pnpm-(?:workspace\.yaml|lock\.yaml)|electron-builder\.[^/]+|biome\.jsonc?|\.oxlintrc\.json)$/.test(
        relative
      )
    ) {
      documents.push('docs/agent-guide.md')
    }
    if (/(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[^/]+$/.test(relative)) {
      documents.push('docs/testing.md')
    }
    if (relative.endsWith('.css')) documents.push('docs/styling.md')
    if (relative.startsWith('packages/ui/src/')) documents.push('packages/ui/README.md')
    if (relative.startsWith('packages/ai-providers/src/')) {
      documents.push('packages/ai-providers/README.md')
    }
    if (relative.startsWith('tests/e2e/')) documents.push('tests/e2e/README.md')
    if (
      (/^(src\/|packages\/[^/]+\/src\/)/.test(relative) && /(^|\/)index\.ts$/.test(relative)) ||
      relative.startsWith('src/shared/ipc/') ||
      /^scripts\/lint\/architecture(?:\.test)?\.mjs$/.test(relative) ||
      relative === 'eslint.config.mjs'
    ) {
      documents.push('docs/design.md')
    }

    const pending = []
    for (const document of new Set(documents)) {
      const content = await readFile(path.join(root, document), 'utf8')
      const digest = createHash('sha256').update(`${root}\0${document}\0${content}`).digest('hex')
      const session = input.session_id
      let first = true
      if (typeof session === 'string' && session.length > 0) {
        const state = path.join(os.tmpdir(), 'agent-context')
        await mkdir(state, { recursive: true, mode: 0o700 })
        const key = createHash('sha256').update(`${session}\0${digest}`).digest('hex')
        try {
          await writeFile(path.join(state, key), '', { flag: 'wx', mode: 0o600 })
        } catch (error) {
          if (error.code !== 'EEXIST') throw error
          first = false
        }
      }
      if (first) pending.push({ document, content })
    }
    if (pending.length > 0) {
      // Reserve every read notice before fitting full documents into the total budget.
      // PreToolUse context informs the next model request, not an already-emitted Edit.
      const contexts = pending.map(
        ({ document }) =>
          `Before continuing this task, read ${document}. Its full contract exceeds the hook's context budget; this notice does not replace it.`
      )
      for (const [index, { document, content }] of pending.entries()) {
        const full = `Project context from ${document}:\n\n${content}`
        const candidate = [...contexts]
        candidate[index] = full
        if (candidate.join('\n\n').length <= 9_500) contexts[index] = full
      }
      systemReminder(contexts.join('\n\n'))
    }
  }
}

async function resolveNewPath(requested) {
  const suffix = []
  let ancestor = requested
  let links = 0
  while (true) {
    try {
      return path.join(await realpath(ancestor), ...suffix)
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
    }
    // realpath cannot resolve dangling links; inspect them before falling back to a parent.
    const entry = await lstat(ancestor).catch((error) => {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
    })
    if (entry?.isSymbolicLink()) {
      if (++links > 40) {
        throw Object.assign(new Error('Too many symbolic links while resolving project path'), {
          code: 'ELOOP'
        })
      }
      ancestor = path.resolve(path.dirname(ancestor), await readlink(ancestor), ...suffix)
      suffix.length = 0
    } else {
      suffix.unshift(path.basename(ancestor))
      ancestor = path.dirname(ancestor)
    }
  }
}

function systemReminder(context) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: context }
    })}\n`
  )
}
