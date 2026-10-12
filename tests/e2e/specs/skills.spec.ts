import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WindowApiType } from '../../../src/preload/api'
import { expect, test } from '../fixtures/electron.fixture'
import { waitForAppReady } from '../utils/wait-helpers'

test('user browses local skills when opening settings, then reads the real document across processes', async ({
  app
}, testInfo) => {
  test.setTimeout(120_000)
  await waitForAppReady(app.window)
  const defaultRoot = await app.window.evaluate(async () => {
    if (!('api' in window)) throw new Error('The renderer preload API is unavailable.')
    // SAFETY: The real preload exposes this public API at the checked window property.
    const api = window.api as WindowApiType
    const projects = await api.workspaces.list()
    const project = projects.find(({ isDefault }) => isDefault)
    if (!project) throw new Error('Default workspace is missing.')
    return project.rootPath
  })
  const root = join(defaultRoot, '.agents', 'skills')
  for (const name of ['review', 'design']) {
    const directory = join(root, name)
    await mkdir(directory, { recursive: true })
    const description =
      name === 'review'
        ? `description: |\n  review project changes\n${Array.from({ length: 20 }, (_, index) => `  Review requirement ${index + 1}: inspect changes.`).join('\n')}`
        : `description: ${name} project changes`
    await writeFile(
      join(directory, 'SKILL.md'),
      `---\nname: ${name}\n${description}\nuser-invocable: false\n---\n# ${name} instructions\n\nRead the **project** carefully.\n\n\`\`\`ts\nconst ready = true\n${'// A long source line '.repeat(30)}\n\`\`\`\n\n${Array.from({ length: 60 }, (_, index) => `Review step ${index + 1}: inspect the project carefully.`).join('\n\n')}`
    )
  }
  await app.window.getByRole('button', { name: 'Settings', exact: true }).click()
  await app.window.getByRole('button', { name: 'Skills', exact: true }).click()
  const review = app.window.getByRole('button', { name: 'View review' })
  const search = app.window.getByRole('textbox', { name: 'Search skills' })
  for (const theme of ['Light', 'Dark']) {
    await app.window.getByRole('button', { name: 'Appearance', exact: true }).click()
    await app.window.getByRole('radio', { name: theme, exact: true }).click()
    await app.window.getByRole('button', { name: 'Skills', exact: true }).click()
    await search.fill('review')
    // The native application enforces a minimum window size of 1000 × 800.
    for (const width of [1000, 1024, 1440]) {
      await app.electronApp.evaluate(({ BrowserWindow }, windowWidth) => {
        const window = BrowserWindow.getAllWindows()[0]
        if (!window) throw new Error('Application window is missing.')
        window.setSize(windowWidth, 860)
      }, width)
      await expect(review).toBeVisible()
      await expect(review).toContainText('Model only')
      await expect(app.window.getByRole('button', { name: 'View design' })).toHaveCount(0)
      const listPath = testInfo.outputPath(`skills-${theme.toLowerCase()}-${width}.png`)
      await app.window.screenshot({ path: listPath })
      await testInfo.attach(`Skills ${theme} ${width}`, {
        path: listPath,
        contentType: 'image/png'
      })
      await review.click()
      const dialog = app.window.getByRole('dialog', { name: 'review', exact: true })
      await expect(dialog).toBeVisible()
      await expect(dialog).toHaveAccessibleDescription(/review project changes/)
      expect(
        await dialog
          .locator('[data-slot="dialog-description"]')
          .evaluate((element) => element.scrollHeight > element.clientHeight)
      ).toBe(true)
      await expect(dialog.getByRole('button', { name: 'Code', exact: true })).toBeInViewport()
      try {
        await expect(dialog.getByRole('heading', { name: 'review instructions' })).toBeVisible()
      } catch (error) {
        // Capture the stalled boundary before another UI action can flush pending updates.
        const [native, document] = await Promise.all([
          app.electronApp.evaluate(({ BrowserWindow }) => {
            const window = BrowserWindow.getAllWindows()[0]
            return {
              focused: window?.isFocused(),
              visible: window?.isVisible(),
              minimized: window?.isMinimized(),
              bounds: window?.getBounds(),
              activeResources: process.getActiveResourcesInfo()
            }
          }),
          app.window.evaluate(async () => {
            if (!('api' in window)) throw new Error('The renderer preload API is unavailable.')
            // SAFETY: The real preload exposes this public API at the checked window property.
            const api = window.api as WindowApiType
            const startedAt = performance.now()
            const deadline = AbortSignal.timeout(2000)
            const probe = (async () => {
              const projects = await api.workspaces.list()
              const project = projects.find(({ isDefault }) => isDefault)
              if (!project) throw new Error('Default workspace is missing.')
              const document = await api.skills.readDocument({
                projectId: project.id,
                skillId: 'project-agents:review'
              })
              return { state: 'resolved', contentLength: document.content.length }
            })().catch((error: Error) => ({
              state: 'rejected',
              error: error.message
            }))
            const result = await Promise.race([
              probe,
              new Promise<{ state: string }>((resolve) => {
                deadline.addEventListener('abort', () => resolve({ state: 'pending' }), {
                  once: true
                })
              })
            ])
            return {
              ...result,
              elapsedMs: performance.now() - startedAt,
              visibility: document.visibilityState,
              focused: document.hasFocus(),
              dialogText: document.querySelector('[role="dialog"]')?.textContent
            }
          })
        ])
        await testInfo.attach('Skill document loading diagnostics', {
          body: JSON.stringify({ native, document }, null, 2),
          contentType: 'application/json'
        })
        throw error
      }
      const codeBlock = dialog.getByTestId('code-block')
      await expect(codeBlock).toHaveAttribute('data-state', 'complete')
      await expect(codeBlock.getByRole('button', { name: 'Copy code' })).toBeVisible()
      await expect(codeBlock.locator('[data-code-token]').first()).toBeVisible()
      expect(
        await codeBlock.evaluate((element) => {
          const markdown = element.closest('.mico-markdown')
          const pre = element.querySelector('pre')
          const scroll = pre?.parentElement
          if (!markdown || !scroll) throw new Error('The Markdown code viewport is missing.')
          return {
            widthGap: Math.abs(
              element.getBoundingClientRect().width - markdown.getBoundingClientRect().width
            ),
            scrolls: scroll.scrollWidth > scroll.clientWidth
          }
        })
      ).toEqual({ widthGap: 0, scrolls: true })
      const viewport = await dialog.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        return {
          contained:
            bounds.left >= 0 &&
            bounds.top >= 0 &&
            bounds.right <= innerWidth &&
            bounds.bottom <= innerHeight,
          horizontalOverflow: element.scrollWidth > element.clientWidth,
          pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
        }
      })
      expect(viewport).toEqual({ contained: true, horizontalOverflow: false, pageOverflow: false })
      const content = dialog.getByRole('region', { name: 'SKILL.md content' })
      expect(await content.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
        true
      )
      await content.evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
      await expect(
        dialog.getByText('Review step 60: inspect the project carefully.')
      ).toBeInViewport()
      await expect(dialog.getByRole('button', { name: 'Code', exact: true })).toBeInViewport()
      await dialog.getByRole('button', { name: 'Code', exact: true }).click()
      const source = dialog.getByLabel('SKILL.md source')
      await expect(source).toContainText('user-invocable: false')
      expect(await source.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
        true
      )
      await dialog.getByRole('button', { name: 'Preview', exact: true }).click()
      await content.evaluate((element) => {
        element.scrollTop = 0
      })
      await expect(dialog.getByRole('heading', { name: 'review instructions' })).toBeInViewport()
      const detailPath = testInfo.outputPath(`skills-detail-${theme.toLowerCase()}-${width}.png`)
      await app.window.screenshot({ path: detailPath })
      await testInfo.attach(`Skill dialog ${theme} ${width}`, {
        path: detailPath,
        contentType: 'image/png'
      })
      const close = dialog.getByRole('button', { name: 'Close', exact: true })
      const closePoint = await close.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        const x = bounds.left + bounds.width / 2
        const y = bounds.top + bounds.height / 2
        return { x, y, hit: element.contains(document.elementFromPoint(x, y)) }
      })
      expect(closePoint.hit).toBe(true)
      // Long documents place Close inside the native titlebar drag band. Browser
      // mouse events bypass that native routing, so verify its exclusion separately.
      const titlebar = app.window.locator('.home-workspace__titlebar')
      const titlebarBounds = await titlebar.boundingBox()
      if (!titlebarBounds) throw new Error('The native titlebar is missing.')
      expect(closePoint.y).toBeLessThan(titlebarBounds.y + titlebarBounds.height)
      expect(
        await dialog.evaluate((element) =>
          getComputedStyle(element).getPropertyValue('-webkit-app-region')
        )
      ).toBe('no-drag')
      await app.window.mouse.click(closePoint.x, closePoint.y)
      await expect(dialog).toHaveCount(0)
      await expect(review).toBeFocused()
      await expect(search).toHaveValue('review')
    }
    await review.click()
    await app.window
      .getByRole('dialog', { name: 'review', exact: true })
      .getByRole('button', { name: 'Close', exact: true })
      .click()
    await expect(review).toBeFocused()
    await expect(search).toHaveValue('review')
  }
  await search.clear()
  // Native folder selection is an OS surface; the workspace registration and
  // cross-page catalog refresh remain real.
  await app.electronApp.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
  }, app.workspaceDir)
  await app.window.getByRole('button', { name: 'Workspaces', exact: true }).click()
  await app.window.getByRole('button', { name: 'Add Workspace' }).click()
  await expect(app.window.getByRole('heading', { name: 'project', exact: true })).toBeVisible()
  await app.window.getByRole('button', { name: 'Back', exact: true }).click()
  await app.window.getByRole('button', { name: /^Workspace:|^Choose workspace$/ }).click()
  await app.window.getByRole('option', { name: 'project', exact: true }).click()
  await app.window.getByRole('button', { name: 'Settings', exact: true }).click()
  await app.window.getByRole('button', { name: 'Skills', exact: true }).click()
  await expect(app.window.getByRole('combobox', { name: 'Workspace' })).toHaveCount(0)
  await expect(app.window.getByText('No skills found in this workspace.')).toBeVisible()
})
