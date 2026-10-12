import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import architecture from './architecture.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const linter = new Linter({ cwd: root })
function check(file, code) {
  return linter.verify(
    code,
    {
      plugins: { architecture },
      rules: { 'architecture/process-imports': 'error' }
    },
    { filename: resolve(root, file) }
  )
}

describe('Process imports', () => {
  it.each([
    ['src/renderer/src/example.js', "import 'node:fs'"],
    ['src/shared/example.js', "import 'path'"],
    ['src/shared/example.js', "import 'react'"],
    ['src/renderer/src/example.js', "import '@electron-toolkit/utils'"],
    ['packages/ai-providers/src/example.js', "import 'electron'"],
    ['src/renderer/src/example.js', "import('@main/main')"],
    ['src/renderer/src/example.js', "import '@shared/../main/main'"],
    ['src/renderer/src/example.js', "export * from '../../main/main'"],
    ['src/shared/example.js', "export { value } from '../renderer/src/App'"],
    ['src/preload/example.js', "require('../main/main')"],
    ['packages/ui/src/example.js', "import '@shared/data/types'"],
    ['packages/ai-providers/src/example.js', "import '../../../src/main/main'"],
    ['src/main/example.js', "import '../../packages/ai-providers/src/index'"],
    ['src/main/example.js', "import '@mico/ai-providers/streaming/sse'"],
    ['src/renderer/src/example.js', "import '@mico/ui/src/index'"],
    ['src/shared/example.js', "import '../main/../main/main'"],
    ['src/renderer/src/example.js', "import 'electron'"],
    ['src/renderer/src/example.js', "import '@mico/ai-providers'"],
    ['src/main/example.js', "import './ai/conversation/runtime'"],
    ['src/main/example.js', "export * from '@main/ai/workspace/tools/registry'"],
    ['src/main/ai/conversation/example.js', "import('../workspace/tools/registry')"],
    ['src/main/ai/models/example.js', "import '../conversation'"],
    ['src/main/ai/workspace/example.js', "require('../models')"],
    ['src/main/ai/workspace/example.js', "import '@main/ai/conversation/index'"],
    ['src/main/ai/conversation/example.js', "import '../models/index/../selection'"],
    ['src/main/ai/workspace/example.js', "import '@shared/../main/ai/models'"],
    ['src/main/example.js', "import '@renderer/../../main/ai/conversation/runtime'"]
  ])('user checks %s when importing %s, then lint rejects it', (file, code) => {
    const messages = check(file, code)
    expect(messages).toHaveLength(1)
    expect(messages[0].ruleId).toBe('architecture/process-imports')
  })
  it.each([
    ['src/main/example.js', "import '@mico/ai-providers'"],
    ['src/main/example.js', "import 'node:fs/promises'"],
    ['src/preload/example.js', "import 'electron'"],
    ['src/renderer/src/example.js', "import '@mico/ui'"],
    ['src/renderer/src/example.js', "import('@shared/theme/theme-registry')"],
    ['src/shared/example.js', "import './data/types'"],
    ['packages/ui/src/example.js', "import '@mico/ui/lib/utils'"],
    ['packages/ai-providers/src/example.js', "import './streaming/sse'"],
    ['src/main/example.js', "import './ai/conversation'"],
    ['src/main/example.js', "import '@main/ai/models/index'"],
    ['src/main/ai/conversation/example.js', "import '../workspace'"],
    ['src/main/ai/conversation/example.js', "export * from '../models/index.js'"],
    ['src/main/ai/conversation/example.js', "import './runtime'"],
    ['src/main/ai/workspace/tools/example.js', "import '../skills/snapshot'"]
  ])('user checks %s when importing %s, then lint accepts it', (file, code) => {
    expect(check(file, code)).toEqual([])
  })
})
