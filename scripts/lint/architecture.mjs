import { isBuiltin } from 'node:module'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const locations = {
  main: 'src/main/',
  preload: 'src/preload/',
  renderer: 'src/renderer/',
  shared: 'src/shared/',
  ui: 'packages/ui/',
  providers: 'packages/ai-providers/'
}
const allowed = {
  main: new Set(['main', 'shared', 'providers']),
  preload: new Set(['preload', 'shared']),
  renderer: new Set(['renderer', 'shared', 'ui']),
  shared: new Set(['shared']),
  ui: new Set(['ui']),
  providers: new Set(['providers'])
}

function owner(filename) {
  const path = relative(root, filename).replaceAll('\\', '/')
  return Object.entries(locations).find(([, prefix]) => path.startsWith(prefix))?.[0]
}

const aiDependencies = {
  conversation: new Set(['models', 'workspace']),
  models: new Set(),
  workspace: new Set()
}

function aiModule(filename) {
  const path = relative(root, filename).replaceAll('\\', '/')
  const match = /^src\/main\/ai\/(conversation|models|workspace)(?:\/(.*))?$/.exec(path)
  return match ? { name: match[1], entry: match[2] } : undefined
}

const processImports = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      forbidden:
        '{{source}} must not import {{target}}. Use its owning process or package interface.',
      privatePackage: 'Consume workspace packages through their public exports.',
      privateAiModule: 'Consume {{target}} through its public module root.',
      aiDirection:
        '{{source}} must not import {{target}}. AI module dependencies must remain acyclic.'
    }
  },
  create(context) {
    const source = owner(context.filename)
    if (!source) return {}
    const check = (node) => {
      const specifier = node?.value
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- ESLint supplies literals of several types; only strings identify imports.
      if (typeof specifier !== 'string') return
      const native =
        isBuiltin(specifier) || specifier === 'electron' || specifier.startsWith('electron/')
      const electron =
        specifier === 'electron' ||
        specifier.startsWith('electron/') ||
        specifier.startsWith('@electron-toolkit/')
      const browser = ['react', 'react-dom', '@ai-sdk/react'].some(
        (name) => specifier === name || specifier.startsWith(`${name}/`)
      )
      if (
        (native && ['renderer', 'shared', 'ui'].includes(source)) ||
        (electron && !['main', 'preload'].includes(source)) ||
        (browser && source === 'shared')
      ) {
        context.report({ node, messageId: 'forbidden', data: { source, target: specifier } })
        return
      }
      const resolvedPath = specifier.startsWith('.')
        ? resolve(dirname(context.filename), specifier)
        : specifier.startsWith('@main/')
          ? resolve(root, 'src/main', specifier.slice('@main/'.length))
          : specifier.startsWith('@renderer/')
            ? resolve(root, 'src/renderer/src', specifier.slice('@renderer/'.length))
            : specifier.startsWith('@shared/')
              ? resolve(root, 'src/shared', specifier.slice('@shared/'.length))
              : undefined
      const targetAi = resolvedPath ? aiModule(resolvedPath) : undefined
      const sourceAi = aiModule(context.filename)
      if (targetAi && sourceAi?.name !== targetAi.name) {
        if (sourceAi && !aiDependencies[sourceAi.name].has(targetAi.name)) {
          context.report({
            node,
            messageId: 'aiDirection',
            data: { source: sourceAi.name, target: targetAi.name }
          })
          return
        }
        if (targetAi.entry && !/^index(?:\.[cm]?[jt]sx?)?$/.test(targetAi.entry)) {
          context.report({
            node,
            messageId: 'privateAiModule',
            data: { target: targetAi.name }
          })
          return
        }
      }
      let target
      if (resolvedPath) target = owner(resolvedPath)
      else if (specifier === '@mico/ai-providers' || specifier.startsWith('@mico/ai-providers/'))
        target = 'providers'
      else if (specifier === '@mico/ui' || specifier.startsWith('@mico/ui/')) target = 'ui'
      if (target && !allowed[source].has(target)) {
        context.report({ node, messageId: 'forbidden', data: { source, target } })
      } else if (
        (specifier.startsWith('.') && source !== target && ['ui', 'providers'].includes(target)) ||
        specifier.startsWith('@mico/ai-providers/') ||
        specifier.startsWith('@mico/ui/src/')
      ) {
        context.report({ node, messageId: 'privatePackage' })
      }
    }
    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
      TSExternalModuleReference: (node) => check(node.expression),
      CallExpression: (node) => {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require')
          check(node.arguments[0])
      }
    }
  }
}

export default { rules: { 'process-imports': processImports } }
