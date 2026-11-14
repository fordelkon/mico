import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../', import.meta.url))
const documents = [
  'docs/agent-guide.md',
  'docs/testing.md',
  'docs/styling.md',
  'docs/design.md',
  'docs/agent-context-loading.md',
  'packages/ui/README.md',
  'packages/ai-providers/README.md',
  'tests/e2e/README.md'
]

// Keep the reference's subprocess boundary, with synthetic contracts and isolated temp state.
function fixture(t) {
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'mico-context-test-')))
  const project = path.join(directory, 'project')
  const hook = path.join(project, '.claude/hooks/context.mjs')
  const temporary = path.join(directory, 'tmp')
  mkdirSync(path.dirname(hook), { recursive: true })
  mkdirSync(temporary)
  copyFileSync(path.join(root, '.claude/hooks/context.mjs'), hook)
  function doc(name, text) {
    const file = path.join(project, name)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, text)
  }
  for (const document of documents) doc(document, `CONTRACT ${document}`)
  t.onTestFinished(() => rmSync(directory, { recursive: true, force: true }))
  return {
    directory,
    project,
    temporary,
    doc,
    run(file, { session = randomUUID(), tool = 'Read', cwd = project } = {}) {
      const input = { tool_name: tool, tool_input: { file_path: file }, cwd }
      if (session !== null) input.session_id = session
      const result = spawnSync(process.execPath, [hook], {
        cwd: directory,
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: project,
          TMPDIR: temporary,
          TMP: temporary,
          TEMP: temporary
        },
        input: JSON.stringify(input),
        encoding: 'utf8',
        timeout: 5_000
      })
      expect(result.error).toBeUndefined()
      expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' })
      if (!result.stdout) return ''
      const output = JSON.parse(result.stdout)
      expect(Object.keys(output)).toEqual(['hookSpecificOutput'])
      expect(Object.keys(output.hookSpecificOutput).sort()).toEqual([
        'additionalContext',
        'hookEventName'
      ])
      expect(output.hookSpecificOutput.hookEventName).toBe('PreToolUse')
      const text = output.hookSpecificOutput.additionalContext
      expect(text.length).toBeLessThanOrEqual(9_500)
      return text
    }
  }
}

describe('Project context hook', () => {
  it('user opens project files when contracts apply, then receives matching guidance', (t) => {
    const f = fixture(t)
    expect(f.run('src/main/new.ts')).toContain('CONTRACT docs/agent-guide.md')
    expect(f.run('electron.vite.config.ts')).toContain('CONTRACT docs/agent-guide.md')
    expect(f.run('tsconfig.node.json')).toContain('CONTRACT docs/agent-guide.md')
    expect(f.run('package.json')).toContain('CONTRACT docs/agent-guide.md')
    const ui = f.run('packages/ui/src/button.css', { tool: 'Edit' })
    expect(ui).toContain('CONTRACT docs/agent-guide.md')
    expect(ui).toContain('CONTRACT docs/styling.md')
    expect(ui).toContain('CONTRACT packages/ui/README.md')
    const provider = f.run('packages/ai-providers/src/example.spec.ts', { tool: 'Write' })
    expect(provider).toContain('CONTRACT packages/ai-providers/README.md')
    expect(provider).toContain('CONTRACT docs/testing.md')
    const e2e = f.run('tests/e2e/specs/chat.spec.ts')
    expect(e2e).toContain('CONTRACT docs/testing.md')
    expect(e2e).toContain('CONTRACT tests/e2e/README.md')
    expect(f.run('src/main/ai/models/index.ts')).toContain('CONTRACT docs/design.md')
    expect(f.run('src/shared/ipc/contracts.ts')).toContain('CONTRACT docs/design.md')
    expect(f.run('scripts/lint/architecture.mjs')).toContain('CONTRACT docs/design.md')
  })

  it('user revisits guidance when its content changes, then receives the updated contract', (t) => {
    const f = fixture(t)
    const session = randomUUID()
    expect(f.run('src/new.ts', { session })).toContain('CONTRACT docs/agent-guide.md')
    expect(f.run('package.json', { session })).toBe('')
    f.doc('docs/agent-guide.md', 'UPDATED CONTRACT')
    expect(f.run('src/new.ts', { session })).toContain('UPDATED CONTRACT')
    expect(f.run('src/new.ts')).toContain('UPDATED CONTRACT')
    expect(f.run('src/new.ts', { session: null })).toContain('UPDATED CONTRACT')
    expect(f.run('src/new.ts', { session: null })).toContain('UPDATED CONTRACT')
  })

  it('user maintains agent context when opening its files, then receives loading guidance', (t) => {
    const f = fixture(t)
    for (const file of [
      '.agents/skills/mico/SKILL.md',
      '.claude/hooks/context.mjs',
      'AGENTS.md',
      'docs/agent-references.md'
    ]) {
      const text = f.run(file)
      expect(text).toContain('CONTRACT docs/agent-context-loading.md')
      expect(text).toContain('CONTRACT docs/agent-guide.md')
    }
    const settings = JSON.parse(readFileSync(path.join(root, '.claude/settings.json'), 'utf8'))
    expect(settings).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Read|Edit|Write',
            hooks: [
              {
                type: 'command',
                command: 'node "${CLAUDE_PROJECT_DIR}/.claude/hooks/context.mjs"',
                timeout: 5
              }
            ]
          }
        ]
      }
    })
  })

  it('user opens unrelated paths when no contract applies, then receives no context', (t) => {
    const f = fixture(t)
    expect(f.run('LICENSE')).toBe('')
    expect(f.run('docs/other.md')).toBe('')
    expect(f.run('../src/outside.ts')).toBe('')
    expect(f.run('src/new.ts', { tool: 'Bash' })).toBe('')
    expect(f.run(undefined)).toBe('')
  })

  it('user follows links when writing new paths, then guidance respects canonical containment', (t) => {
    const f = fixture(t)
    mkdirSync(path.join(f.project, 'src'))
    const outside = path.join(f.directory, 'outside')
    mkdirSync(outside)
    writeFileSync(path.join(outside, 'existing.ts'), 'export {}\n')
    symlinkSync(path.join(f.project, 'src'), path.join(f.project, 'alias'))
    expect(f.run('alias/new/deep.ts', { tool: 'Write' })).toContain('CONTRACT docs/agent-guide.md')
    symlinkSync(outside, path.join(f.project, 'src/external'))
    expect(f.run('src/external/existing.ts')).toBe('')
    expect(f.run('src/external/new/deep.ts', { tool: 'Write' })).toBe('')
    symlinkSync(path.join(outside, 'new.ts'), path.join(f.project, 'src/new.ts'))
    expect(f.run('src/new.ts', { tool: 'Write' })).toBe('')
    symlinkSync(path.join(outside, 'missing'), path.join(f.project, 'src/directory'))
    expect(f.run('src/directory/new/deep.ts', { tool: 'Write' })).toBe('')
    symlinkSync('../tests/new.spec.ts', path.join(f.project, 'src/target.ts'))
    symlinkSync('target.ts', path.join(f.project, 'src/chain.ts'))
    const text = f.run('src/chain.ts', { tool: 'Write' })
    expect(text).toContain('CONTRACT docs/testing.md')
    expect(text).not.toContain('CONTRACT docs/agent-guide.md')
  })

  it('user needs large contracts when context is bounded, then receives explicit read notices', (t) => {
    const f = fixture(t)
    const guide = `GUIDE ${'g'.repeat(9_000)}`
    f.doc('docs/agent-guide.md', guide)
    f.doc('packages/ui/README.md', `UI ${'u'.repeat(9_000)}`)
    f.doc('docs/design.md', `DESIGN ${'d'.repeat(17_000)}`)
    const text = f.run('packages/ui/src/index.ts')
    expect(text).toContain(guide)
    expect(text).toContain('read packages/ui/README.md')
    expect(text).toContain('read docs/design.md')
    expect(text).toContain('this notice does not replace it')
    expect(text).not.toContain('UI u')
    expect(text).not.toContain('DESIGN d')
  })
})
