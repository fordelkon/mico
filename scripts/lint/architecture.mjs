import { createRequire, isBuiltin } from 'node:module'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const workspace = createRequire(import.meta.url)
const aliases = { '@main': 'src/main', '@renderer': 'src/renderer/src', '@shared': 'src/shared' }
const allowed = {
  main: ['main', 'shared', 'agent-core', 'ai-providers', 'coding-agent', 'contracts'],
  preload: ['preload', 'shared', 'contracts'],
  renderer: ['renderer', 'shared', 'ui', 'contracts'],
  shared: ['shared', 'contracts'],
  ui: ['ui'],
  'agent-core': ['agent-core', 'ai-providers'],
  'coding-agent': ['coding-agent', 'contracts', 'agent-core', 'ai-providers'],
  contracts: ['contracts'],
  'ai-providers': ['ai-providers']
}

function projectPath(filename) {
  return relative(root, filename).replaceAll('\\', '/')
}

function owner(path) {
  if (/^packages\/coding-agent\/src\/contracts(?:\/|$)/.test(path)) return 'contracts'
  return /^(?:src|packages)\/([^/]+)/.exec(path)?.[1]
}

const chat = 'src/renderer/src/hooks/chat'
const conversation = 'src/main/ai/conversation'

function moduleRoot(path) {
  if (path === chat || path.startsWith(`${chat}/`)) return chat
  return /^src\/main\/ai\/(?:conversation|models|workspace|memory)(?=\/|$)/.exec(path)?.[0]
}

function resolveImport(specifier, filename) {
  if (specifier.startsWith('.')) return projectPath(resolve(dirname(filename), specifier))
  if (specifier.startsWith('@mico/')) {
    // Node resolves the same workspace export map used by the application.
    return projectPath(workspace.resolve(specifier))
  }
  const [alias, ...parts] = specifier.split('/')
  if (Object.hasOwn(aliases, alias))
    return projectPath(resolve(root, aliases[alias], parts.join('/')))
}

const processImports = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      forbidden:
        '{{source}} must not import {{target}}. Use its owning process or package interface.',
      privatePackage: 'Consume workspace packages through their public exports.',
      privateModule: 'Consume {{target}} through its public module root.',
      chatSdk: 'Keep SDK Chat instances and subscriptions inside the renderer chat runtime.',
      aiDirection:
        '{{source}} must not import {{target}}. Conversation composes the desktop AI modules.'
    }
  },
  create(context) {
    const filename = context.filename
    const path = projectPath(filename)
    const source = owner(path)
    if (!Object.hasOwn(allowed, source)) return {}
    const sourceModule = moduleRoot(path)
    const isTest = /\.test\.[cm]?[jt]sx?$/.test(path)
    const ownsSdk =
      sourceModule === chat ||
      /^src\/renderer\/src\/services\/ai-transport\/[^/]+\.test\.[jt]s$/.test(path)

    function check(node) {
      const specifier = node?.value
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Only string literals identify imports.
      if (typeof specifier !== 'string') return
      const sdk = /^@ai-sdk\/react(?:\/|$)/.test(specifier)
      if (source === 'renderer' && sdk && !ownsSdk) {
        context.report({ node, messageId: 'chatSdk' })
        return
      }
      let targetPath
      try {
        targetPath = resolveImport(specifier, filename)
      } catch {
        context.report({ node, messageId: 'privatePackage' })
        return
      }
      const target = targetPath && owner(targetPath)
      const native = isBuiltin(specifier)
      const electron = /^(?:electron(?:\/|$)|@electron-toolkit\/)/.test(specifier)
      const restrictedExternal =
        source === 'contracts' &&
        !target &&
        specifier !== 'zod' &&
        !(specifier === 'ai' && node.parent.importKind === 'type') &&
        !(specifier === 'vitest' && isTest)
      if (
        (target && !allowed[source].includes(target)) ||
        (electron && source !== 'main' && source !== 'preload') ||
        (native &&
          (['renderer', 'shared', 'ui'].includes(source) ||
            (source === 'agent-core' && !isTest))) ||
        (source === 'shared' && (sdk || /^react(?:-dom)?(?:\/|$)/.test(specifier))) ||
        restrictedExternal
      ) {
        context.report({ node, messageId: 'forbidden', data: { source, target: specifier } })
        return
      }
      if (!targetPath) return
      if (
        targetPath.startsWith('packages/') &&
        !specifier.startsWith('@mico/') &&
        source !== target &&
        !(source === 'coding-agent' && target === 'contracts')
      ) {
        context.report({ node, messageId: 'privatePackage' })
        return
      }
      const targetModule = moduleRoot(targetPath)
      if (!targetModule || targetModule === sourceModule) return
      if (source === 'main' && sourceModule && sourceModule !== conversation && !isTest) {
        context.report({
          node,
          messageId: 'aiDirection',
          data: { source: sourceModule, target: targetModule }
        })
      } else if (
        targetPath !== targetModule &&
        !/^\/index(?:\.[cm]?[jt]sx?)?$/.test(targetPath.slice(targetModule.length))
      ) {
        context.report({ node, messageId: 'privateModule', data: { target: targetModule } })
      }
    }
    return {
      'ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration, ImportExpression': (node) =>
        check(node.source),
      TSExternalModuleReference: (node) => check(node.expression),
      "CallExpression[callee.type='Identifier'][callee.name='require']": (node) =>
        check(node.arguments[0])
    }
  }
}

export default { rules: { 'process-imports': processImports } }
