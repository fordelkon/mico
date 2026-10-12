import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WindowApiType } from '../../../src/preload/api'
import { expect, test } from '../fixtures/local-provider.fixture'
import { composer } from '../utils/chat'
import { editKeys } from '../utils/edit-keys'
import { waitForAppReady } from '../utils/wait-helpers'

/** Reads the composer's mirror handoff state at the real browser boundary. */
function readComposerState(page: import('@playwright/test').Page): Promise<{
  composing: string | null
  mirrorVisibility: string
}> {
  return page.evaluate(() => {
    const input = document.querySelector('textarea[aria-label="Message"]')
    if (!(input instanceof HTMLTextAreaElement))
      throw new Error('The composer textarea is missing.')
    const mirror = input.parentElement?.querySelector('[aria-hidden="true"]')
    if (!mirror) throw new Error('The composer highlight mirror is missing.')
    return {
      composing: input.getAttribute('data-composing'),
      mirrorVisibility: getComputedStyle(mirror).visibility
    }
  })
}

test('user edits an invocation when drafting, then completion, atomic deletion, and undo behave natively', async ({
  app
}) => {
  await waitForAppReady(app.window)
  const defaultRoot = await app.window.evaluate(async () => {
    if (!('api' in window)) throw new Error('The renderer preload API is unavailable.')
    // SAFETY: The real preload exposes this public API at the checked window property.
    const api = window.api as WindowApiType
    const project = (await api.workspaces.list()).find(({ isDefault }) => isDefault)
    if (!project) throw new Error('Default workspace is missing.')
    return project.rootPath
  })
  const skillDirectory = join(defaultRoot, '.agents', 'skills', 'review')
  await mkdir(skillDirectory, { recursive: true })
  await writeFile(
    join(skillDirectory, 'SKILL.md'),
    '---\nname: review\ndescription: review project changes\n---\n# review instructions\n\nCheck the project carefully.'
  )
  // The composer loads its catalog when it mounts; a page round-trip remounts
  // it so the freshly written skill joins the real discovery catalog.
  await app.window.getByRole('button', { name: 'Settings', exact: true }).click()
  await app.window.getByRole('button', { name: 'Back', exact: true }).click()

  const main = app.window.getByRole('main', { name: 'Main content', exact: true })
  const input = composer(app.window)
  await input.pressSequentially('$rev')
  await expect(main.getByRole('option', { name: /review/ })).toBeVisible()

  // Completion is one real browser edit transaction; the mirrored leading
  // token paints the colored text while the textarea glyphs stay transparent.
  await input.press('Tab')
  await expect(input).toHaveValue('$review ')
  const mirror = await input.evaluate((element) => {
    const mirrorElement = element.parentElement?.querySelector('[aria-hidden="true"]')
    if (!mirrorElement) throw new Error('The composer highlight mirror is missing.')
    return {
      text: mirrorElement.textContent,
      tokens: Array.from(mirrorElement.querySelectorAll('[data-token-kind]')).map(
        (token) => token.textContent
      ),
      color: getComputedStyle(element).color,
      caretColor: getComputedStyle(element).caretColor,
      mirrorColor: getComputedStyle(mirrorElement).color
    }
  })
  expect(mirror).toMatchObject({ text: '$review ', tokens: ['$review'] })
  expect(mirror.color).toBe('rgba(0, 0, 0, 0)')
  expect(mirror.caretColor).not.toBe('rgba(0, 0, 0, 0)')
  expect(mirror.mirrorColor).not.toBe('rgba(0, 0, 0, 0)')

  // Native undo/redo covers the completion transaction exactly like typing.
  await input.press(editKeys.undo)
  await expect(input).toHaveValue('$rev')
  await input.press(editKeys.redo)
  await expect(input).toHaveValue('$review ')

  // A collapsed Backspace behind the trailing separator keeps native behavior;
  // word deletion removes the whole token without a "$" leftover.
  await input.press('Backspace')
  await expect(input).toHaveValue('$review')
  await input.press(editKeys.deleteWord)
  await expect(input).toHaveValue('')
  await input.press(editKeys.undo)
  await expect(input).toHaveValue('$review')
  await input.press(editKeys.undo)
  await expect(input).toHaveValue('$review ')
  await input.press(editKeys.undo)
  await expect(input).toHaveValue('$rev')
  await input.press(editKeys.redo)
  await expect(input).toHaveValue('$review ')

  // Synthetic composition signals exercise the IME mirror handoff; a real OS
  // IME is not available to this suite.
  await input.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  })
  await expect
    .poll(() => readComposerState(app.window))
    .toEqual({ composing: 'true', mirrorVisibility: 'hidden' })
  await input.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  })
  await expect
    .poll(() => readComposerState(app.window))
    .toEqual({ composing: null, mirrorVisibility: 'visible' })
})
