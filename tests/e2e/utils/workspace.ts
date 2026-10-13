import type { TestApp } from '../fixtures/electron.fixture'

/** Select the real fixture workspace at the native folder-chooser boundary. */
export async function stubWorkspaceChooser(app: TestApp): Promise<void> {
  await app.electronApp.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, app.workspaceDir)
}

/**
 * Register the temporary workspace through the sidebar switcher. Only the
 * native folder chooser is stubbed; selection, registration, and filesystem
 * access remain real.
 */
export async function selectWorkspace(app: TestApp): Promise<void> {
  await stubWorkspaceChooser(app)
  await app.window.getByRole('button', { name: /^Workspace:|^Choose workspace$/ }).click()
  await app.window.getByRole('button', { name: 'Add workspace', exact: true }).click()
  await app.window.getByRole('textbox', { name: 'Search workspaces' }).press('Escape')
}
