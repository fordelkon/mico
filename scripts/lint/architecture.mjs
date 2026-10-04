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

const processImports = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      forbidden:
        '{{source}} must not import {{target}}. Use its owning process or package interface.',
      privatePackage: 'Consume workspace packages through their public exports.'
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
      let target
      if (specifier.startsWith('.')) target = owner(resolve(dirname(context.filename), specifier))
      else if (specifier.startsWith('@main/'))
        target = owner(resolve(root, 'src/main', specifier.slice('@main/'.length)))
      else if (specifier.startsWith('@renderer/'))
        target = owner(resolve(root, 'src/renderer/src', specifier.slice('@renderer/'.length)))
      else if (specifier.startsWith('@shared/'))
        target = owner(resolve(root, 'src/shared', specifier.slice('@shared/'.length)))
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
