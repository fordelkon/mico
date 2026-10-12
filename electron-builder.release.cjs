const path = require('node:path')

const repository = process.env.GITHUB_REPOSITORY
if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
  throw new Error('Set GITHUB_REPOSITORY to the GitHub owner/repository before building a release.')
}
const [owner, repo] = repository.split('/')

module.exports = {
  extends: path.resolve(__dirname, 'electron-builder.yml'),
  forceCodeSigning: true,
  electronDist: 'node_modules/electron/dist',
  publish: [{ provider: 'github', owner, repo }],
  win: { target: ['nsis'] },
  nsis: { artifactName: '${productName}-${version}-windows-${arch}-setup.${ext}' },
  mac: { target: ['dmg', 'zip'], hardenedRuntime: true, notarize: true },
  dmg: { artifactName: '${productName}-${version}-macos-${arch}.${ext}' },
  artifactName: '${productName}-${version}-macos-${arch}.${ext}'
}
