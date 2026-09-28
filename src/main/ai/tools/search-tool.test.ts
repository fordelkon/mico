import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { ToolRegistry } from './tool-registry'
import { createTemporaryWorkspace, removeTemporaryPaths } from './test-helpers'

describe('workspace search tools', () => {
  afterEach(() => removeTemporaryPaths())

  it('user searches a regex when case differs, then flags control matching and line numbers', async () => {
    const cwd = await createTemporaryWorkspace('mico-search-')
    await writeFile(join(cwd, 'example.ts'), 'other\nconst key = "A.B"\nconst similar = "axb"')
    const registry = ToolRegistry.forWorkspace(cwd)
    const signal = new AbortController().signal
    const result = await registry.execute(
      {
        toolCallId: 'regex',
        toolName: 'Grep',
        input: { pattern: 'a\\.b', '-i': true, output_mode: 'content', glob: '**/*.ts' }
      },
      signal
    )
    expect(result.isError).toBe(false)
    expect(result.output).toContain('example.ts:2:const key = "A.B"')
    expect(result.output).not.toContain('axb')
    const sensitive = await registry.execute(
      {
        toolCallId: 'case',
        toolName: 'Grep',
        input: { pattern: 'a\\.b' }
      },
      signal
    )
    expect(sensitive.output).toBe('No matches found.')
    const regex = await registry.execute(
      {
        toolCallId: 'wildcard',
        toolName: 'Grep',
        input: { pattern: 'a.b', output_mode: 'content' }
      },
      signal
    )
    expect(regex.output).toContain('example.ts:3:const similar = "axb"')
  })

  it('user finds filenames when ignored and linked folders exist, then only project sources appear', async () => {
    const cwd = await createTemporaryWorkspace('mico-search-')
    const outside = await createTemporaryWorkspace('mico-search-outside-')
    await mkdir(join(cwd, 'src'))
    await mkdir(join(cwd, 'node_modules'))
    await writeFile(join(cwd, '.ignore'), 'node_modules/')
    await writeFile(join(cwd, 'src', 'app.ts'), 'source')
    await writeFile(join(cwd, 'node_modules', 'dependency.ts'), 'dependency')
    await writeFile(join(outside, 'secret.ts'), 'external')
    await symlink(outside, join(cwd, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    const result = await ToolRegistry.forWorkspace(cwd).execute(
      { toolCallId: 'files', toolName: 'Glob', input: { pattern: '**/*.ts' } },
      new AbortController().signal
    )
    expect(result.isError).toBe(false)
    expect(result.output).toContain('Found 1 file(s).\nsrc/app.ts')
    expect(result.output).not.toContain('secret.ts')
    expect(result.output).not.toContain('dependency.ts')
  })

  it('user pages search results when matches span files, then counts include undisplayed files', async () => {
    const cwd = await createTemporaryWorkspace('mico-search-')
    await writeFile(join(cwd, 'a.txt'), 'match\nmatch\nmatch')
    await writeFile(join(cwd, 'b.txt'), 'match')
    const registry = ToolRegistry.forWorkspace(cwd)
    const signal = new AbortController().signal
    const content = await registry.execute(
      {
        toolCallId: 'page',
        toolName: 'Grep',
        input: { pattern: 'match', output_mode: 'content', offset: 1, head_limit: 1 }
      },
      signal
    )
    expect(content.output).toContain('a.txt:2:match')
    expect(content.output).not.toContain('a.txt:1:')
    expect(content.output).toContain('More results available.')
    const counts = await registry.execute(
      {
        toolCallId: 'count',
        toolName: 'Grep',
        input: { pattern: 'match', output_mode: 'count', head_limit: 1 }
      },
      signal
    )
    expect(counts.output).toContain('a.txt:3')
    expect(counts.output).toContain('Total matching lines: 4.')
    const files = await registry.execute(
      {
        toolCallId: 'names',
        toolName: 'Grep',
        input: { pattern: 'match', head_limit: 0 }
      },
      signal
    )
    expect(files.output).toContain('a.txt')
    expect(files.output).toContain('b.txt')
    expect(files.output).not.toContain(':match')
  })

  it('user supplies an invalid regex or external path when searching, then the tool returns an actionable error', async () => {
    const cwd = await createTemporaryWorkspace('mico-search-')
    const registry = ToolRegistry.forWorkspace(cwd)
    const signal = new AbortController().signal
    const invalid = await registry.execute(
      {
        toolCallId: 'invalid',
        toolName: 'Grep',
        input: { pattern: '[' }
      },
      signal
    )
    expect(invalid.isError).toBe(true)
    expect(invalid.output).toContain('regex parse error')
    const outside = await registry.execute(
      {
        toolCallId: 'escape',
        toolName: 'Glob',
        input: { pattern: '**/*', path: '..' }
      },
      signal
    )
    expect(outside.isError).toBe(true)
    expect(outside.output).toContain('inside the session workspace')
  })

  it('user requests context and multiline matches when searching, then results honor those options', async () => {
    const cwd = await createTemporaryWorkspace('mico-search-')
    await writeFile(join(cwd, 'a.ts'), 'before\nstart\nend\nafter')
    const registry = ToolRegistry.forWorkspace(cwd)
    const signal = new AbortController().signal
    const context = await registry.execute(
      {
        toolCallId: 'context',
        toolName: 'Grep',
        input: { pattern: 'start', output_mode: 'content', context: 1, '-n': false, type: 'ts' }
      },
      signal
    )
    expect(context.output).toContain('a.ts-before')
    expect(context.output).toContain('a.ts:start')
    expect(context.output).toContain('a.ts-end')
    const multiline = await registry.execute(
      {
        toolCallId: 'multiline',
        toolName: 'Grep',
        input: { pattern: 'start.*end', multiline: true, output_mode: 'content' }
      },
      signal
    )
    expect(multiline.output).toContain('a.ts:2:start')
    expect(multiline.output).toContain('a.ts:3:end')
  })
})
