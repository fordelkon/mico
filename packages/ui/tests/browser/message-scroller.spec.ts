import { expect, test } from '@playwright/test'

test('user reads earlier replies when content arrives, then a reduced-motion jump resumes following instantly', async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/iframe.html?id=components-primitives-messagescroller--streaming&viewMode=story')
  const viewport = page.getByRole('region', { name: 'Messages' })
  const append = page.getByRole('button', { name: 'Append response' })
  const jump = page.getByRole('button', { name: 'Scroll to end', includeHidden: true })
  const distanceToEnd = (): Promise<number> =>
    viewport.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)

  await expect.poll(distanceToEnd).toBeLessThanOrEqual(1)
  await append.click()
  await expect(page.getByText(/^Assistant response 17:/)).toBeAttached()
  await expect.poll(distanceToEnd).toBeLessThanOrEqual(1)

  await viewport.hover()
  await page.mouse.wheel(0, -600)
  await expect(jump).toHaveAttribute('data-active', 'true')
  await expect.poll(distanceToEnd).toBeGreaterThan(200)
  // Let layout and the real scroll observers settle before recording the reading position.
  const readingPosition = await viewport.evaluate(async (element) => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )
    return element.scrollTop
  })
  await append.click()
  await expect(page.getByText(/^Assistant response 18:/)).toBeAttached()
  const positionAfterAppend = await viewport.evaluate(async (element) => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )
    return element.scrollTop
  })
  expect(Math.abs(positionAfterAppend - readingPosition)).toBeLessThanOrEqual(1)
  await expect(jump).toHaveAttribute('data-active', 'true')

  // Change the preference on the mounted story; a render-time snapshot would be stale.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const immediateJump = await jump.evaluate((element) => {
    if (!(element instanceof HTMLButtonElement)) throw new Error('The jump button is missing.')
    const scroller = element.closest('[data-slot="message-scroller"]')
    const messages = scroller?.querySelector('[data-slot="message-scroller-viewport"]')
    if (!(messages instanceof HTMLElement)) throw new Error('The message viewport is missing.')
    element.click()
    return {
      distance: messages.scrollHeight - messages.clientHeight - messages.scrollTop,
      transition: getComputedStyle(element).transitionProperty
    }
  })
  // Observe the same click turn, so a smooth animation cannot pass after merely settling.
  expect(immediateJump.distance).toBeLessThanOrEqual(1)
  expect(immediateJump.transition).toBe('none')
  await expect(jump).toHaveAttribute('data-active', 'false')
  await append.click()
  await expect(page.getByText(/^Assistant response 19:/)).toBeAttached()
  await expect.poll(distanceToEnd).toBeLessThanOrEqual(1)
})
