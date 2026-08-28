import { access, copyFile } from 'node:fs/promises'
import { constants } from 'node:fs'

const source = 'build/icons/icon.icns'
const destination = 'node_modules/electron/dist/Electron.app/Contents/Resources/electron.icns'

try {
  await access(source, constants.R_OK)
  await access(destination, constants.W_OK)
  await copyFile(source, destination)
  console.log(`[dev-icon] synced ${destination}`)
} catch (error) {
  if (error?.code === 'ENOENT') {
    console.log('[dev-icon] Electron.app icon not found; skipping dev icon sync')
  } else {
    throw error
  }
}
