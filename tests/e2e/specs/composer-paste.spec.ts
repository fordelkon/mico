import { expect, test } from '../fixtures/local-provider.fixture'
import { selectTheme } from '../utils/appearance'
import { assistantMessages, composer, waitForReply } from '../utils/chat'
import { editKeys } from '../utils/edit-keys'
import { waitForAppReady } from '../utils/wait-helpers'

/** Exercises the paste handler with synthetic clipboard data in Electron. */
async function pasteText(page: import('@playwright/test').Page, text: string): Promise<void> {
  await page.evaluate((payload) => {
    const input = document.querySelector('textarea[aria-label="Message"]')
    if (!(input instanceof HTMLTextAreaElement))
      throw new Error('The composer textarea is missing.')
    input.focus()
    const transfer = new DataTransfer()
    transfer.setData('text/plain', payload)
    input.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
    )
  }, text)
}

test('user pastes a long text when drafting, then the token collapses, undoes natively, copies expanded, and sends the full text', async ({
  app,
  provider
}) => {
  await waitForAppReady(app.window)
  const longText = `error ${'x'.repeat(1_200)}`
  const input = composer(app.window)
  await input.click()
  await pasteText(app.window, longText)

  // The draft holds one short visible label with a unique ID; the mirror
  // paints the same glyphs so the caret width never changes.
  const label = await input.inputValue()
  expect(label).toMatch(/^\[Pasted 1,206 chars · [a-z0-9]{6}\]$/)
  await expect(
    app.window
      .getByRole('main', { name: 'Main content', exact: true })
      .locator('[data-token-kind="paste"]')
  ).toHaveText(label)

  // Native undo/redo covers the capture transaction, and the exact unique
  // label re-associates the full payload after any undo/redo order.
  await input.press(editKeys.undo)
  await expect(input).toHaveValue('')
  await input.press(editKeys.redo)
  await expect(input).toHaveValue(label)

  // Copying a selection that touches the token delivers the full payload.
  await input.press(editKeys.selectAll)
  await input.press(editKeys.copy)
  const clipboardText = await app.electronApp.evaluate(({ clipboard }) => clipboard.readText())
  expect(clipboardText).toBe(longText)

  // Settings unmounts the composer. Returning with the same draft must align
  // the visible mirror with the native caret before any further input.
  for (const appearance of ['Light', 'Dark'] as const) {
    await selectTheme(app.window, appearance)
    await expect(input).toHaveValue(label)
    for (const width of [1_000, 1_200]) {
      await app.electronApp.evaluate(({ BrowserWindow }, nextWidth) => {
        BrowserWindow.getAllWindows()[0].setSize(nextWidth, 800)
      }, width)
      await expect
        .poll(() =>
          input.evaluate((element) => {
            const mirror = document.querySelector('.chat-composer__mirror')
            if (!(mirror instanceof HTMLDivElement)) return ['missing mirror']
            const inputStyle = getComputedStyle(element)
            const mirrorStyle = getComputedStyle(mirror)
            const mismatches = [
              'font-family',
              'font-size',
              'line-height',
              'padding-top',
              'padding-left',
              'white-space',
              'overflow-wrap'
            ].filter(
              (property) =>
                inputStyle.getPropertyValue(property) !== mirrorStyle.getPropertyValue(property)
            )
            if (mirror.clientWidth !== element.clientWidth) mismatches.push('width')
            return mismatches
          })
        )
        .toEqual([])
    }
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(1_000, 800)
    })
  }

  // Sending expands the token: the provider receives the original text and
  // the draft clears with its token metadata.
  await input.press('End')
  await input.pressSequentially('Explain this log')
  const turn = provider.enqueue({ type: 'text', text: 'It is an error log.' })
  await app.window.getByRole('button', { name: 'Send message', exact: true }).click()
  const request = await turn.received
  expect(request.messages.at(-1)).toMatchObject({
    role: 'user',
    content: `${longText}Explain this log`
  })
  await expect(input).toHaveValue('')
  await waitForReply(app.window, assistantMessages(app.window).last())
})

test('user edits a paste token label when drafting, then sending is blocked until the original label returns', async ({
  app,
  provider
}) => {
  await waitForAppReady(app.window)
  const input = composer(app.window)
  await input.click()
  await pasteText(app.window, 'a'.repeat(1_200))
  const label = await input.inputValue()

  // Breaking the label keeps the payload in the draft but blocks sending with
  // an actionable error instead of silently dropping the original text.
  // (Arrow keys jump atomically across tokens, so the caret is placed
  // directly inside the label through the real selection API.)
  await input.evaluate((element) => {
    if (!(element instanceof HTMLTextAreaElement))
      throw new Error('The composer input is not a textarea.')
    element.setSelectionRange(4, 4)
  })
  // A collapsed insertion inside the label breaks it (Backspace would remove
  // the whole token atomically, which is the retirement path instead).
  await input.pressSequentially('x')
  const broken = await input.inputValue()
  expect(broken).not.toBe(label)
  await expect(app.window.getByRole('alert').filter({ hasText: 'pasted text token' })).toBeVisible()
  await expect(app.window.getByRole('button', { name: 'Send message' })).toBeEnabled()

  // The repair applies through one native edit transaction; undoing the
  // repair lands on the broken label again, still without payload loss.
  await app.window.getByRole('button', { name: 'Restore pasted text' }).click()
  await expect(input).toHaveValue(label)
  await input.press(editKeys.undo)
  const repairedUndo = await input.inputValue()
  expect(repairedUndo).not.toBe(label)
  await app.window.getByRole('button', { name: 'Restore pasted text' }).click()
  await expect(input).toHaveValue(label)

  // Intact tokens submit normally: the provider receives the full payload.
  const turn = provider.enqueue({ type: 'text', text: 'done' })
  await app.window.getByRole('button', { name: 'Send message', exact: true }).click()
  const request = await turn.received
  expect(request.messages.at(-1)).toMatchObject({ role: 'user', content: 'a'.repeat(1_200) })
  await waitForReply(app.window, assistantMessages(app.window).last())
})
