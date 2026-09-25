import { basename } from 'node:path'

import { expect, test } from '../fixtures/electron.fixture'
import { waitForAppReady } from '../utils/wait-helpers'

test.describe('Workspace management', () => {
  test('user adds a project folder when picking one in workspace settings, then it is listed', async ({
    app
  }) => {
    await waitForAppReady(app.window)

    // The native folder picker is an OS surface; stub it in the main process
    // and hand the scenario a real temporary directory.
    const projectDir = app.workspaceDir
    await app.electronApp.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
    }, projectDir)

    await app.window.getByRole('button', { name: 'Settings' }).click()
    await app.window.getByRole('button', { name: 'Workspaces' }).click()
    await app.window.getByRole('button', { name: 'Add Workspace' }).click()

    // The row shows the folder name and its full path, which both contain the
    // basename; assert on the row heading only.
    await expect(app.window.getByRole('heading', { name: basename(projectDir) })).toBeVisible()
  })
})
