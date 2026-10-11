import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, test } from '../fixtures/local-provider.fixture'
import { assistantMessages, composer, sendUserMessage, waitForReply } from '../utils/chat'

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
  expect(firstRequest.tools?.map(({ function: tool }) => tool.name)).toEqual(
    expect.arrayContaining(['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write'])
  )
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
  const activity = app.window.getByRole('region', { name: 'Agent activity', exact: true })
  await expect(activity.getByRole('status').filter({ hasText: /^Searched/ })).toHaveText(
    'Searched 1 pattern · Read 1 file · Updated 1 file · Ran 1 command'
  )
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
  const update = app.window.getByRole('button', { name: /^Update greeting.ts/ })
  if ((await update.getAttribute('aria-expanded')) === 'false') await update.click()
  if ((await completedCommand.getAttribute('aria-expanded')) === 'false')
    await completedCommand.click()
  await app.window.screenshot({ path: testInfo.outputPath('tool-details-dark-narrow.png') })
  expect(
    await app.window.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  ).toBe(true)
  await completedCommand.click()
  await expect(completedCommand).toHaveAttribute('aria-expanded', 'false')
  await expect(app.window.getByRole('log', { name: 'Terminal output' })).toBeHidden()
  await update.click()
  await expect(update).toHaveAttribute('aria-expanded', 'false')
  await expect(diff).toBeHidden()
  await app.window.screenshot({ path: testInfo.outputPath('tool-details-collapsed.png') })
})

test('user edits a file when the provider temporarily fails, then recovery preserves the committed edit', async ({
  app,
  provider
}, testInfo) => {
  await writeFile(join(app.workspaceDir, 'recovery.txt'), 'TOKEN')
  // Only the OS picker is replaced; selection, permissions, and file operations remain real.
  await app.electronApp.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, app.workspaceDir)
  await app.window.getByRole('button', { name: /^Workspace:|^Choose workspace$/ }).click()
  await app.window.getByRole('button', { name: 'Add workspace', exact: true }).click()
  await app.window.getByRole('textbox', { name: 'Search workspaces' }).press('Escape')
  await app.window.getByRole('button', { name: 'Tool permissions' }).click()
  await app.window.getByRole('menuitemradio', { name: 'Accept edits' }).click()
  provider.enqueue({
    type: 'tool',
    name: 'Read',
    id: 'read-before-recovery',
    input: { file_path: 'recovery.txt' }
  })
  provider.enqueue({
    type: 'tool',
    name: 'Edit',
    id: 'committed-edit',
    input: { file_path: 'recovery.txt', old_string: 'TOKEN', new_string: 'TOKEN_UPDATED' }
  })
  const rejected = provider.enqueue({ type: 'error', status: 503, retryAfter: '3' })
  const recovered = provider.enqueue({ type: 'text', text: 'The committed edit was preserved.' })
  await composer(app.window).fill('Read recovery.txt and update its token once.')
  await app.window.getByRole('button', { name: 'Send message' }).click()
  const failedRequest = await rejected.received
  expect(failedRequest.messages).toContainEqual(
    expect.objectContaining({
      role: 'tool',
      tool_call_id: 'committed-edit',
      content: 'Successfully replaced 1 occurrence(s) in recovery.txt.'
    })
  )
  expect(await readFile(join(app.workspaceDir, 'recovery.txt'), 'utf8')).toBe('TOKEN_UPDATED')
  await expect(
    app.window.getByRole('status').filter({ hasText: 'Connection interrupted.' })
  ).toBeVisible()
  await app.window.screenshot({ path: testInfo.outputPath('committed-edit-retrying.png') })
  const resumedRequest = await recovered.received
  expect(
    resumedRequest.messages.filter(
      ({ role, tool_call_id }) => role === 'tool' && tool_call_id === 'committed-edit'
    )
  ).toEqual([
    expect.objectContaining({ content: 'Successfully replaced 1 occurrence(s) in recovery.txt.' })
  ])
  await waitForReply(app.window, assistantMessages(app.window).last())
  await expect(assistantMessages(app.window).last()).toContainText(
    'The committed edit was preserved.'
  )
  await expect(
    app.window.getByRole('region', { name: 'Agent activity', exact: true }).getByRole('status')
  ).toHaveText('Read 1 file · Updated 1 file')
  await expect(
    app.window
      .getByTestId('answer-content')
      .filter({ hasText: 'Read recovery.txt and update its token once.' })
  ).toHaveCount(1)
  expect(await readFile(join(app.workspaceDir, 'recovery.txt'), 'utf8')).toBe('TOKEN_UPDATED')
  expect(provider.requests).toHaveLength(4)
  await app.window.screenshot({ path: testInfo.outputPath('committed-edit-recovered.png') })
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
  await app.window.getByRole('button', { name: 'Tool permissions' }).click()
  await app.window.getByRole('menuitemradio', { name: 'Accept edits' }).click()

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
  const sidebar = app.window.getByLabel('Sidebar', { exact: true })
  // The conversation files under its project group, which starts collapsed after a restart.
  const projectGroupToggle = sidebar.getByRole('button', { name: 'Toggle project conversations' })
  if ((await projectGroupToggle.getAttribute('aria-expanded')) === 'false')
    await projectGroupToggle.click()
  await sidebar.getByRole('button', { name: 'E2E conversation', exact: true }).click()
  await expect(
    app.window.getByRole('region', { name: 'Agent activity', exact: true }).getByRole('status')
  ).toHaveText('Wrote 1 file · Updated 1 file')
  await app.window
    .getByRole('button', { name: 'Write result.txt Wrote 1 line to result.txt.', exact: true })
    .click()
  await expect(app.window.getByText('File preview', { exact: true })).toBeVisible()
  await expect(assistantMessages(app.window).last().getByTestId('answer-content')).toHaveText(
    'Created result.txt in the workspace.'
  )
  expect(await readFile(join(app.workspaceDir, 'result.txt'), 'utf8')).toBe('MICO_EDITED_RESULT')
})

test('user invokes a manual slash skill when following its reference, then details survive restart', async ({
  app,
  provider
}, testInfo) => {
  const skillDirectory = join(app.workspaceDir, '.agents', 'skills', 'mico-e2e-skill')
  const skillBody = 'Follow MICO_SKILL_BODY and read references/guide.md before replying.'
  const resourceBody = '# Reference guide\nUse MICO_SKILL_RESOURCE when completing the request.'
  const description = `Follow the Mico E2E reference guide. ${'Read the guide before responding. '.repeat(16).trim()}`
  await mkdir(join(skillDirectory, 'references'), { recursive: true })
  const invalidSkillPaths = await Promise.all(
    Array.from({ length: 12 }, async (_, index) => {
      const directory = join(app.workspaceDir, '.agents', 'skills', `invalid-${index}`)
      await mkdir(directory, { recursive: true })
      const path = join(directory, 'SKILL.md')
      await writeFile(
        path,
        '---\nname: INVALID\ndescription: Invalid metadata.\n---\nBroken skill.'
      )
      return path
    })
  )
  await writeFile(
    join(skillDirectory, 'SKILL.md'),
    `---\nname: mico-e2e-skill\ndescription: ${description}\ndisable-model-invocation: true\n---\n${skillBody}\n`
  )
  await writeFile(join(skillDirectory, 'references', 'guide.md'), resourceBody)
  // Replace only the native folder chooser; workspace selection and discovery remain real.
  await app.electronApp.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, app.workspaceDir)
  await app.window.getByRole('button', { name: /^Workspace:|^Choose workspace$/ }).click()
  await app.window.getByRole('button', { name: 'Add workspace', exact: true }).click()
  await app.window.getByRole('textbox', { name: 'Search workspaces' }).press('Escape')

  const resource = provider.enqueue({
    type: 'tool',
    name: 'ReadSkillResource',
    id: 'read-skill-reference',
    input: { skill_id: 'mico-e2e-skill', relative_path: 'references/guide.md' }
  })
  const answer = provider.enqueue({ type: 'text', text: 'Followed the skill and its reference.' })
  const draft = composer(app.window)
  await draft.fill('/')
  await expect(app.window.getByRole('option', { name: /^mico-e2e-skill / })).toBeVisible()
  await expect(app.window.getByText('mico-e2e-skill', { exact: true })).toBeVisible()
  const skillDescription = app.window.getByText(description, { exact: true })
  await expect(skillDescription).toBeVisible()
  await expect(skillDescription).toHaveCSS('white-space', 'nowrap')
  await expect(skillDescription).toHaveCSS('text-overflow', 'ellipsis')
  await expect(app.window.getByText('Manual only', { exact: true })).toHaveCount(0)
  const skillMenu = app.window.getByRole('region', { name: 'Skill commands' })
  const warnings = skillMenu.getByText('12 skill discovery warnings', { exact: true })
  await expect(warnings).toBeVisible()
  await expect(skillMenu.getByText(invalidSkillPaths[0], { exact: true })).toBeHidden()
  await app.window.screenshot({ path: testInfo.outputPath('skill-menu-light.png') })
  await warnings.focus()
  await warnings.press('Space')
  await expect(warnings).toBeFocused()
  const warningList = skillMenu.getByRole('list', { name: 'Skill discovery warnings' })
  await expect(warningList).toBeVisible()
  await expect(warningList.getByRole('listitem')).toHaveCount(12)
  await warningList.getByRole('listitem').last().scrollIntoViewIfNeeded()
  await expect(warningList.getByRole('listitem').last()).toBeInViewport()
  await app.window.screenshot({ path: testInfo.outputPath('skill-warnings-expanded-light.png') })
  await warnings.press('Space')
  await skillMenu.getByRole('button', { name: 'Retry skills', exact: true }).click()
  await expect(warnings).toBeVisible()
  await expect(draft).toHaveValue('/')
  await draft.focus()
  await draft.press('Escape')
  await app.window.getByRole('button', { name: 'Settings', exact: true }).click()
  await app.window.getByRole('button', { name: 'Appearance', exact: true }).click()
  await app.window.getByRole('radio', { name: 'Dark', exact: true }).click()
  await app.window.getByRole('button', { name: 'Back', exact: true }).click()
  await app.electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(768, 850)
  )
  await expect(app.window.locator('html')).toHaveClass(/dark/)
  await draft.fill('')
  await draft.fill('/')
  await expect(app.window.getByRole('option', { name: /^mico-e2e-skill / })).toBeVisible()
  await draft.focus()
  await expect(draft).toBeFocused()
  expect(
    await app.window.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  ).toBe(true)
  await app.window.screenshot({ path: testInfo.outputPath('skill-menu-dark-narrow.png') })
  await draft.press('Tab')
  await expect(draft).toHaveValue('/skill:mico-e2e-skill ')
  await expect(draft).toBeFocused()
  await sendUserMessage(app.window, '/skill:mico-e2e-skill follow its reference guide.')
  const resourceRequest = await resource.received
  expect(resourceRequest.messages).toContainEqual(
    expect.objectContaining({ role: 'user', content: expect.stringContaining(skillBody) })
  )
  const answerRequest = await answer.received
  expect(answerRequest.messages).toContainEqual(
    expect.objectContaining({
      role: 'tool',
      tool_call_id: 'read-skill-reference',
      content: expect.stringContaining(resourceBody)
    })
  )
  await app.window
    .getByRole('button', {
      name: /^Read skill resource mico-e2e-skill\/references\/guide\.md/
    })
    .click()
  for (const line of resourceBody.split('\n'))
    await expect(app.window.getByRole('log', { name: 'File content' })).toContainText(line)
  await expect(app.window.locator('.conversation-row__title')).toHaveText('E2E conversation')

  const followUp = provider.enqueue({ type: 'text', text: 'Completed the follow-up.' })
  await sendUserMessage(app.window, 'Continue without invoking a skill.')
  const followUpRequest = await followUp.received
  expect(followUpRequest.messages.findLast(({ role }) => role === 'user')?.content).toBe(
    'Continue without invoking a skill.'
  )
  expect(
    followUpRequest.messages
      .filter(({ role }) => role === 'system')
      .map(({ content }) => content)
      .join('\n')
  ).not.toContain(skillBody)

  await app.relaunch()
  const sidebar = app.window.getByLabel('Sidebar', { exact: true })
  const projectToggle = sidebar.getByRole('button', { name: 'Toggle project conversations' })
  if ((await projectToggle.getAttribute('aria-expanded')) === 'false') await projectToggle.click()
  await sidebar.getByRole('button', { name: 'E2E conversation', exact: true }).click()
  await app.window
    .getByRole('button', {
      name: /^Read skill resource mico-e2e-skill\/references\/guide\.md/
    })
    .click()
  for (const line of resourceBody.split('\n'))
    await expect(app.window.getByRole('log', { name: 'File content' })).toContainText(line)
  await expect(assistantMessages(app.window).last().getByTestId('answer-content')).toHaveText(
    'Completed the follow-up.'
  )
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
  const activity = app.window.getByRole('region', { name: 'Agent activity', exact: true })
  await expect(activity.getByRole('status')).toHaveText('1 tool failed')
  // A failed read has no panel: its invocation header and error line are the whole row.
  await expect(app.window.getByText('(missing-e2e-file.txt)', { exact: true })).toBeVisible()
  await expect(app.window.locator('.agent-activity__result--error')).toContainText(
    /missing-e2e-file|exist|ENOENT/i
  )
})
