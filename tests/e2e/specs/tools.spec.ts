import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, test } from '../fixtures/local-provider.fixture'
import { assistantMessages, composer, sendUserMessage } from '../utils/chat'

test('user inspects file changes and a running command when tools execute, then details remain readable through completion', async ({
  app,
  provider
}, testInfo) => {
  await app.window.emulateMedia({ reducedMotion: 'reduce' })
  await app.electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1280, 900)
  )
  await app.electronApp.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, app.workspaceDir)
  await app.window.getByRole('button', { name: /^Workspace:|^Choose workspace$/ }).click()
  await app.window.getByRole('button', { name: 'Add workspace', exact: true }).click()
  await app.window.getByRole('textbox', { name: 'Search workspaces' }).press('Escape')
  const original = 'export function greeting() {\n  return "Hello"\n}\n'
  const updated = original.replace('Hello', 'Welcome')
  await writeFile(join(app.workspaceDir, 'greeting.ts'), original)
  // The command waits on a real file event, so UI assertions control when output completes.
  await writeFile(
    join(app.workspaceDir, 'trace-command.cjs'),
    `
const fs = require('node:fs')
const watcher = fs.watch('.', () => {
  if (fs.existsSync('continue.txt')) {
    console.log('Final output')
    watcher.close()
  }
})
console.log(Array.from({ length: 40 }, (_, i) => 'Output line ' + (i + 1)).join('\\n'))
console.error('Diagnostic output')
`
  )
  const searchResponse = provider.enqueue({
    type: 'tool',
    name: 'Grep',
    id: 'search-source',
    reasoning:
      'Locate the greeting first.\nRead the original before changing it, then check the output.',
    input: { output_mode: 'content', pattern: 'Hello', glob: '**/*.ts' }
  })
  provider.enqueue({
    type: 'tool',
    name: 'Read',
    id: 'read-source',
    input: { file_path: 'greeting.ts' }
  })
  provider.enqueue({
    type: 'tool',
    name: 'Edit',
    id: 'update-source',
    input: {
      file_path: 'greeting.ts',
      old_string: original,
      new_string: updated
    }
  })
  provider.enqueue({
    type: 'tool',
    name: 'Bash',
    id: 'run-command',
    input: { command: 'node trace-command.cjs' }
  })
  provider.enqueue({ type: 'text', text: 'Updated the greeting and checked the command.' })
  await composer(app.window).fill('Read and update the greeting, then run the command.')
  await app.window.getByRole('button', { name: 'Send message' }).click()
  await app.window
    .getByRole('group', { name: 'Approval for Edit', exact: true })
    .getByRole('button', { name: 'Allow once' })
    .click()
  await app.window
    .getByRole('group', { name: 'Approval for Bash', exact: true })
    .getByRole('button', { name: 'Allow once' })
    .click()
  const firstRequest = await searchResponse.received
  expect(firstRequest.tools?.map(({ function: tool }) => tool.name).sort()).toEqual([
    'Bash',
    'Edit',
    'Glob',
    'Grep',
    'Read',
    'Write'
  ])
  const bash = app.window.getByRole('button', { name: /^Bash node trace-command\.cjs / })
  await expect(bash).toBeVisible()
  const thought = app.window.getByRole('button', { name: 'Thought', exact: true })
  await expect(thought).toContainText('Locate the greeting first.')
  await thought.click()
  await expect(app.window.getByLabel('Reasoning', { exact: true })).toContainText(
    'Read the original before changing it'
  )
  await app.window.screenshot({ path: testInfo.outputPath('thinking-expanded.png') })
  await thought.click()
  const search = app.window.getByRole('button', { name: /^Grep Hello/ })
  await search.click()
  await expect(app.window.getByRole('log', { name: 'Search results' })).toContainText(
    'greeting.ts:2:'
  )
  await search.click()
  await expect(app.window.getByRole('log', { name: 'Terminal output' })).toBeHidden()
  await app.window.getByRole('button', { name: /^Read greeting.ts/ }).click()
  await expect(app.window.getByRole('log', { name: 'File content' })).toContainText('Hello')
  await app.window.getByRole('button', { name: /^Read greeting.ts/ }).click()
  await app.window.getByRole('button', { name: /^Update greeting.ts/ }).click()
  const diff = app.window.getByRole('log', { name: 'File diff' })
  await expect(diff).toContainText('-  return "Hello"')
  await expect(diff).toContainText('+  return "Welcome"')
  await bash.focus()
  await app.window.keyboard.press('Enter')
  const output = app.window.getByRole('log', { name: 'Terminal output' })
  try {
    await expect(output).toContainText('Output line 40')
    await expect(output).toContainText('Diagnostic output')
    await expect(app.window.getByTitle('node trace-command.cjs', { exact: true })).toBeVisible()
    await app.window.screenshot({ path: testInfo.outputPath('tool-details-light.png') })
  } finally {
    await writeFile(join(app.workspaceDir, 'continue.txt'), 'continue')
  }
  await expect(
    assistantMessages(app.window).last().getByRole('button', { name: 'Copy message' })
  ).toBeAttached()
  const activity = app.window.getByRole('button', {
    name: 'Agent activity: Searched 1 pattern · Read 1 file · Updated 1 file · Ran 1 command',
    exact: true
  })
  await expect(activity).toHaveAttribute('aria-expanded', 'false')
  await activity.click()
  const completedCommand = app.window.getByRole('button', {
    name: /^Bash node trace-command\.cjs/
  })
  if ((await completedCommand.getAttribute('aria-expanded')) === 'false')
    await completedCommand.click()
  await expect(app.window.getByRole('log', { name: 'Terminal output' })).toContainText(
    'Final output'
  )
  expect(await readFile(join(app.workspaceDir, 'greeting.ts'), 'utf8')).toBe(updated)
  await app.window.getByRole('button', { name: 'Settings', exact: true }).click()
  await app.window.getByRole('button', { name: 'Appearance', exact: true }).click()
  await app.window.getByRole('radio', { name: 'Dark', exact: true }).click()
  await app.window.getByRole('button', { name: 'Back', exact: true }).click()
  await app.electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1000, 850)
  )
  await expect(app.window.locator('html')).toHaveClass(/dark/)
  if ((await activity.getAttribute('aria-expanded')) === 'false') await activity.click()
  const update = app.window.getByRole('button', { name: /^Update greeting.ts/ })
  if ((await update.getAttribute('aria-expanded')) === 'false') await update.click()
  if ((await completedCommand.getAttribute('aria-expanded')) === 'false')
    await completedCommand.click()
  await app.window.screenshot({ path: testInfo.outputPath('tool-details-dark-narrow.png') })
  expect(
    await app.window.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  ).toBe(true)
  await activity.click()
  await expect(activity).toHaveAttribute('aria-expanded', 'false')
  await app.window.screenshot({ path: testInfo.outputPath('activity-summary.png') })
})

// The only native stub is the OS folder picker; the selected directory is real.
test('user asks for a file when a workspace is selected, then the file and tool transcript survive restart', async ({
  app,
  provider
}) => {
  await app.electronApp.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, app.workspaceDir)
  await app.window.getByRole('button', { name: /^Workspace:|^Choose workspace$/ }).click()
  await app.window.getByRole('button', { name: 'Add workspace', exact: true }).click()
  await expect(app.window.getByRole('button', { name: /^Workspace: project/ })).toBeVisible()
  await app.window.getByRole('textbox', { name: 'Search workspaces' }).press('Escape')
  await expect(app.window.getByRole('textbox', { name: 'Search workspaces' })).toBeHidden()
  await app.window.getByRole('combobox', { name: 'Tool permissions' }).selectOption('acceptEdits')

  const write = provider.enqueue({
    type: 'tool',
    name: 'Write',
    id: 'write-artifact',
    holdArguments: true,
    input: { file_path: 'result.txt', content: 'MICO_TOOL_RESULT' }
  })
  provider.enqueue({
    type: 'tool',
    name: 'Edit',
    id: 'edit-artifact',
    input: {
      file_path: 'result.txt',
      old_string: 'MICO_TOOL_RESULT',
      new_string: 'MICO_EDITED_RESULT'
    }
  })
  const followup = provider.enqueue({
    type: 'text',
    text: 'Created result.txt in the workspace.',
    hold: true
  })
  await composer(app.window).fill('Create result.txt in this workspace.')
  await app.window.getByRole('button', { name: 'Send message' }).click()
  await write.received
  await expect(app.window.getByRole('group', { name: 'Write result.txt Preparing…' })).toBeVisible()
  await expect(readFile(join(app.workspaceDir, 'result.txt'), 'utf8')).rejects.toThrow('ENOENT')
  await expect(app.window.getByText(/Invalid tool input/)).toHaveCount(0)
  write.finishArguments()
  const request = await followup.received
  expect(request.messages).toContainEqual(
    expect.objectContaining({
      role: 'tool',
      tool_call_id: 'write-artifact',
      content: 'Created result.txt.'
    })
  )
  expect(await readFile(join(app.workspaceDir, 'result.txt'), 'utf8')).toBe('MICO_EDITED_RESULT')
  expect(request.messages).toContainEqual(
    expect.objectContaining({
      role: 'tool',
      tool_call_id: 'edit-artifact',
      content: 'Successfully replaced 1 occurrence(s) in result.txt.'
    })
  )
  followup.finish()
  const reply = assistantMessages(app.window).last()
  await expect(reply.getByRole('button', { name: 'Copy message' })).toBeAttached()
  await expect(app.window.locator('.conversation-row__title')).toHaveText('E2E conversation')

  await app.relaunch()
  await app.window
    .getByLabel('Sidebar', { exact: true })
    .getByRole('button', { name: 'E2E conversation', exact: true })
    .click()
  await app.window
    .getByRole('button', {
      name: 'Agent activity: Wrote 1 file · Updated 1 file',
      exact: true
    })
    .click()
  await app.window
    .getByRole('button', { name: 'Write result.txt Wrote 1 line to result.txt.', exact: true })
    .click()
  await expect(app.window.getByText('File preview', { exact: true })).toBeVisible()
  await expect(assistantMessages(app.window).last().getByTestId('answer-content')).toHaveText(
    'Created result.txt in the workspace.'
  )
  expect(await readFile(join(app.workspaceDir, 'result.txt'), 'utf8')).toBe('MICO_EDITED_RESULT')
})

test('user sees a failed file read when the tool cannot find it, then the error is inspectable', async ({
  app,
  provider
}) => {
  provider.enqueue({
    type: 'tool',
    name: 'Read',
    id: 'missing-file',
    input: { file_path: 'missing-e2e-file.txt' }
  })
  provider.enqueue({ type: 'text', text: 'The file could not be read.' })
  await sendUserMessage(app.window, 'Read the missing file.')
  const activity = app.window.getByRole('button', {
    name: 'Agent activity: 1 tool failed',
    exact: true
  })
  await expect(activity).toBeVisible()
  // A live group stays open; reopen only when restored/mounted as historical content.
  if ((await activity.getAttribute('aria-expanded')) === 'false') await activity.click()
  // A failed read has no panel: its invocation header and error line are the whole row.
  await expect(app.window.getByText('(missing-e2e-file.txt)', { exact: true })).toBeVisible()
  await expect(app.window.locator('.agent-activity__result--error')).toContainText(
    /missing-e2e-file|exist|ENOENT/i
  )
})
