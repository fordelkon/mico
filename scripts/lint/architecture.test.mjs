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
    ['src/renderer/src/example.js', "import 'electron'"],
    ['src/renderer/src/example.js', "import '@mico/ai-providers'"],
    ['src/main/example.js', "import './ai/conversation/runtime'"],
    ['src/main/ai/models/example.js', "import '../conversation'"],
    ['src/main/ai/workspace/example.js', "require('../models')"],
    ['src/main/ai/conversation/example.js', "import '../models/index/../resolver'"],
    ['src/main/example.js', "import '@renderer/../../main/ai/conversation/runtime'"],
    ['packages/agent-core/src/example.js', "import '@main/ai/conversation'"],
    ['packages/agent-core/src/example.js', "import '../../../src/main/data/session-database'"],
    ['packages/agent-core/src/example.js', "import '@shared/data/types'"],
    ['packages/agent-core/src/example.js', "import 'node:fs/promises'"],
    ['packages/agent-core/src/example.js', "import 'electron'"],
    ['packages/ai-providers/src/example.js', "import '@mico/agent-core'"],
    ['src/renderer/src/example.js', "import '@mico/agent-core'"],
    ['src/main/example.js', "import '../../packages/agent-core'"],
    ['packages/coding-agent/src/tools/example.js', "import 'electron'"],
    ['packages/coding-agent/src/tools/example.js', "import '@shared/data/types'"],
    ['packages/coding-agent/src/tools/example.js', "import '@main/ai/memory'"],
    ['packages/agent-core/src/example.js', "import '@mico/coding-agent'"],
    ['src/main/example.js', "import '@mico/coding-agent/tools'"],
    ['src/renderer/src/example.js', "import '@mico/coding-agent'"],
    ['src/main/example.js', "import '@mico/ui/lib/utils'"],
    ['src/renderer/src/example.js', "import '@mico/ui/styles/missing.css'"],
    ['src/shared/example.js', "import '@mico/coding-agent/contracts/skills'"],
    ['src/preload/example.js', "import '../../packages/coding-agent/src/contracts'"],
    ['packages/coding-agent/src/contracts/example.js', "export * from '../tools'"],
    ['packages/coding-agent/src/contracts/example.js', "import 'node:fs'"],
    ['packages/coding-agent/src/contracts/example.js', "import '@vscode/ripgrep'"],
    ['src/main/ai/memory/example.js', "import('../conversation')"],
    ['src/main/ai/conversation/example.js', "import '@mico/agent-core/src/model-loop'"],
    ['src/renderer/src/App.js', "import './hooks/chat/chat-session-instances'"],
    [
      'src/renderer/src/components/example.js',
      "import('../hooks/chat/index/../chat-session-instances')"
    ],
    ['src/renderer/src/components/chat/example.js', "import '@ai-sdk/react'"],
    ['src/renderer/src/components/chat/example.test.js', "import '@ai-sdk/react'"],
    ['src/renderer/src/components/chat/example.js', "export * from '@ai-sdk/react/subscription'"]
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
    ['src/main/ai/workspace/example.js', "import '@mico/coding-agent'"],
    ['src/main/ai/conversation/example.js', "import '../memory'"],
    ['packages/coding-agent/src/tools/example.js', "export * from '@mico/agent-core'"],
    ['packages/coding-agent/src/tools/example.js', "import '@mico/ai-providers'"],
    ['packages/coding-agent/src/tools/example.js', "import 'node:fs'"],
    ['packages/coding-agent/src/tools/example.js', "import '../contracts'"],
    ['packages/coding-agent/src/contracts/example.js', "export * from './skills'"],
    ['packages/coding-agent/src/contracts/example.js', "import 'zod'"],
    ['src/renderer/src/example.js', "import '@mico/coding-agent/contracts'"],
    ['src/shared/example.js', "import '@mico/coding-agent/contracts'"],
    ['src/preload/example.js', "import '@mico/coding-agent/contracts'"],
    ['packages/agent-core/src/example.js', "import './contracts'"],
    ['packages/agent-core/src/example.js', "import '@mico/ai-providers'"],
    ['src/main/ai/models/example.test.js', "import '../conversation'"],
    ['packages/agent-core/src/example.test.js', "import 'node:fs/promises'"],
    ['src/renderer/src/App.js', "import './hooks/chat'"],
    ['src/renderer/src/components/chat/example.js', "import '@renderer/hooks/chat/index'"],
    ['src/renderer/src/hooks/chat/example.js', "import './chat-session-instances'"],
    ['src/renderer/src/hooks/chat/example.test.js', "import '@ai-sdk/react'"],
    [
      'src/renderer/src/services/ai-transport/electron-chat-transport.test.js',
      "import '@ai-sdk/react'"
    ]
  ])('user checks %s when importing %s, then lint accepts it', (file, code) => {
    expect(check(file, code)).toEqual([])
  })
})
