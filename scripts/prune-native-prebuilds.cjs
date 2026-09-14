const fs = require('node:fs/promises')
const path = require('node:path')
const { Arch } = require('electron-builder')

exports.default = async function pruneNativePrebuilds(context) {
  const arch = Arch[context.arch]
  const platform = context.electronPlatformName
  const resourcesDirectory =
    platform === 'darwin'
      ? path.join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents',
          'Resources'
        )
      : path.join(context.appOutDir, 'resources')
  const prebuildsDirectory = path.join(
    resourcesDirectory,
    'app.asar.unpacked',
    'node_modules',
    'better-sqlite3',
    'prebuilds'
  )
  const allowedPrebuilds = new Set(
    platform === 'linux'
      ? [`linux-${arch}.node`, `linuxmusl-${arch}.node`]
      : [`${platform}-${arch}.node`]
  )
  const entries = await fs.readdir(prebuildsDirectory, { withFileTypes: true })
  const availablePrebuilds = new Set(
    entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  )

  for (const expectedPrebuild of allowedPrebuilds) {
    if (!availablePrebuilds.has(expectedPrebuild)) {
      throw new Error(`Missing better-sqlite3 prebuild for packaged target: ${expectedPrebuild}`)
    }
  }

  for (const entry of entries) {
    if (entry.isFile() && !allowedPrebuilds.has(entry.name)) {
      await fs.rm(path.join(prebuildsDirectory, entry.name))
    }
  }
}
