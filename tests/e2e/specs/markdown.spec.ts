import { expect, test } from '../fixtures/local-provider.fixture'
import { selectTheme } from '../utils/appearance'
import { assistantMessages, composer, sendUserMessage, waitForReply } from '../utils/chat'

test('user follows a repeated footnote when replies share a label, then returns to the chosen reference', async ({
  app,
  provider
}, testInfo) => {
  const page = app.window
  const note = (name: string) =>
    [
      `First reference[^注] and second reference[^注] in ${name}.`,
      ...Array.from({ length: 24 }, (_, index) => `Paragraph ${index + 1} of the report.`),
      `[^注]: Details for ${name}.`
    ].join('\n\n')
  provider.enqueue({ type: 'text', text: note('January') })
  await sendUserMessage(page, 'January report')
  provider.enqueue({ type: 'text', text: note('February') })
  await sendUserMessage(page, 'February report')
  const originalUrl = page.url()
  // Intercept only the OS launch boundary so regressions cannot open a browser.
  const externalLinks = await app.electronApp.evaluateHandle(({ shell }) => {
    const opened: string[] = []
    shell.openExternal = async (url) => {
      opened.push(url)
    }
    return opened
  })

  for (const theme of ['Light', 'Dark'] as const) {
    await selectTheme(page, theme)
    const reply = assistantMessages(page).last()
    const ref = reply.locator('a[data-footnote-ref]').nth(1)
    const target = reply.locator('[data-footnotes] li').filter({ hasText: 'Details for February.' })
    await ref.focus()
    await ref.press('Enter')
    await expect(target).toBeFocused()
    await expect(target).toBeInViewport()
    await expect(target).toHaveAttribute('id', (await ref.getAttribute('href'))!.slice(1))
    await expect(
      page
        .locator('[data-footnotes] li[id]')
        .evaluateAll((nodes) => new Set(nodes.map((node) => node.id)).size)
    ).resolves.toBe(2)
    const heading = reply.locator('[data-footnotes] h2')
    await expect(ref).toHaveAttribute('aria-describedby', (await heading.getAttribute('id'))!)
    await page.screenshot({ path: testInfo.outputPath('footnote-' + theme + '.png'), scale: 'css' })
    await target.locator('a[data-footnote-backref]').nth(1).click()
    await expect(ref).toBeFocused()
    await expect(ref).toBeInViewport()
    await expect(page).toHaveURL(originalUrl)
    expect(await externalLinks.jsonValue()).toEqual([])
  }
})

test('user reads lists and two snippets when a referenced reply streams, then only the unfinished fence is writing', async ({
  app,
  provider
}, testInfo) => {
  const page = app.window
  await app.electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1000, 800)
  )
  const wrapped = 'Read the complete review before sending the next reply. '.repeat(3)
  const partial = [
    '### Output review',
    '- ' + wrapped + '\n  - A nested item.\n- [x] ' + wrapped + '\n- [ ] Pending review.',
    '1. ' + wrapped,
    'See [the guide][doc].',
    '[doc]: https://example.org/guide',
    '```ts\nconst done = 1\n```',
    '~~~~ts\nconst draft ='
  ].join('\n\n')
  const stream = provider.enqueue({ type: 'text', text: partial, hold: true })
  await composer(page).fill('Show the review')
  await composer(page).press('Enter')
  const reply = assistantMessages(page).last()
  const blocks = reply.getByTestId('code-block')
  await expect(blocks.first()).toHaveAttribute('data-state', 'complete')
  await expect(blocks.last()).toHaveAttribute('data-state', 'streaming')
  await page.screenshot({ path: testInfo.outputPath('fences-live.png'), scale: 'css' })
  stream.finish(' 2\n~~~~')
  await waitForReply(page, reply)
  await expect(blocks.last()).toHaveAttribute('data-state', 'complete')
  for (const theme of ['Light', 'Dark'] as const) {
    await selectTheme(page, theme)
    const task = reply.getByRole('checkbox').first()
    await expect(task).toBeChecked()
    await expect(reply.locator('li.task-list-item').first()).toHaveCSS('list-style-type', 'none')
    const list = reply.locator('ul').first()
    await expect(list).toHaveCSS('list-style-position', 'outside')
    await list.scrollIntoViewIfNeeded()
    // Measure glyphs on the first and second lines, including a task row.
    const offsets = await reply.locator('li').evaluateAll((items) =>
      items.flatMap((item) => {
        const text = Array.from(item.childNodes).find(
          (node) =>
            node.nodeType === Node.TEXT_NODE &&
            node.textContent?.includes('Read the complete review')
        )
        if (!text) return []
        const range = document.createRange()
        range.selectNodeContents(text)
        const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 1)
        return rects.length > 1 ? [Math.abs(rects[0].left - rects[1].left)] : []
      })
    )
    expect(offsets).toHaveLength(3)
    expect(Math.max(...offsets)).toBeLessThan(1)
    await page.screenshot({
      path: testInfo.outputPath('wrapped-lists-' + theme + '.png'),
      scale: 'css'
    })
  }
})
