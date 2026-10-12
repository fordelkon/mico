import { expect, test } from '../fixtures/local-provider.fixture'
import { assistantMessages, composer, sendUserMessage, waitForReply } from '../utils/chat'

test('user views approximate input when a request streams, then status survives completion and navigation', async ({
  app,
  provider
}, testInfo) => {
  const held = provider.enqueue({ type: 'text', text: 'Measured reply.', hold: true })
  await composer(app.window).fill('Measure this prepared request')
  await app.window.getByRole('button', { name: 'Send message' }).click()
  const estimate = app.window.getByText(/^Approximate input: [\d,.\s]+ tokens$/)
  await expect(estimate).toBeVisible()
  await expect(app.window.getByRole('button', { name: 'Stop response' })).toBeVisible()
  await estimate.focus()
  await expect(app.window.getByRole('tooltip')).toContainText('model context limit is unknown')
  await app.window.screenshot({ path: testInfo.outputPath('context-measurement-streaming.png') })
  await app.window.keyboard.press('Escape')
  held.finish()
  await waitForReply(app.window, assistantMessages(app.window).last())
  await expect(estimate).toBeVisible()
  await app.window.getByRole('button', { name: 'New chat', exact: true }).click()
  await expect(estimate).toHaveCount(0)
  await app.window.getByRole('button', { name: 'E2E conversation', exact: true }).click()
  await expect(estimate).toBeVisible()
  await app.window.getByRole('button', { name: 'Settings', exact: true }).click()
  await app.window.getByRole('button', { name: 'Appearance', exact: true }).click()
  await app.window.getByRole('radio', { name: 'Dark', exact: true }).click()
  await app.window.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(estimate).toBeVisible()
  await expect(app.window.locator('html')).toHaveClass(/dark/)
  await app.window.screenshot({ path: testInfo.outputPath('context-measurement-dark.png') })
})

test('user continues a conversation when sending another turn, then each reply finishes separately', async ({
  app,
  provider
}) => {
  provider.enqueue({ type: 'text', text: 'First complete answer.' })
  await expect(await sendUserMessage(app.window, 'First question')).toContainText(
    'First complete answer.'
  )
  provider.enqueue({ type: 'text', text: 'Second complete answer.' })
  await expect(await sendUserMessage(app.window, 'Follow-up question')).toContainText(
    'Second complete answer.'
  )
  await expect(assistantMessages(app.window)).toHaveCount(2)
})

test('user presses modified Enter when a model is selected, then only plain Enter sends the turn', async ({
  app,
  provider
}) => {
  const input = composer(app.window)
  await input.fill('Ctrl draft')
  await input.press('Control+Enter')
  await input.press('Meta+Enter')
  await expect(input).toHaveValue('Ctrl draft')
  await expect(assistantMessages(app.window)).toHaveCount(0)
  await expect(app.window.getByRole('button', { name: 'Send message' })).toBeVisible()

  provider.enqueue({ type: 'text', text: 'The plain Enter turn completed.' })
  await input.press('Enter')
  await waitForReply(app.window, assistantMessages(app.window).last())
  expect(provider.requests).toHaveLength(1)
  await expect(assistantMessages(app.window)).toHaveCount(1)
})

test('user sees an unfinished reply when the stream pauses, then completion controls wait for the end', async ({
  app,
  provider
}) => {
  const response = provider.enqueue({ type: 'text', text: 'Partial answer', hold: true })
  await composer(app.window).fill('Stream an answer')
  await app.window.getByRole('button', { name: 'Send message' }).click()
  const reply = assistantMessages(app.window).last()
  await expect(reply.getByTestId('answer-content')).toHaveText('Partial answer')
  await expect(app.window.getByRole('button', { name: 'Stop response' })).toBeVisible()
  await expect(reply.getByRole('button', { name: 'Copy message' })).toHaveCount(0)
  response.finish(' is now complete.')
  await waitForReply(app.window, reply)
  await expect(reply.getByTestId('answer-content')).toHaveText('Partial answer is now complete.')
})

test('user reads fenced code when a reply streams, then blocks fill the message and scroll long lines', async ({
  app,
  provider
}) => {
  const response = provider.enqueue({
    type: 'text',
    text: '```ts\nconst ready = true\n',
    hold: true
  })
  await composer(app.window).fill('Show a code example')
  await app.window.getByRole('button', { name: 'Send message' }).click()
  const reply = assistantMessages(app.window).last()
  const codeBlock = reply.getByTestId('code-block')
  await expect(codeBlock).toHaveAttribute('data-state', 'streaming')
  const geometry = async () =>
    reply.evaluate((element) => {
      const message = element.querySelector('[data-slot="message-content"]')
      const bubble = element.querySelector('[data-slot="bubble-content"]')
      const markdown = element.querySelector('[data-testid="answer-content"]')
      const block = element.querySelector('[data-slot="code-block"]')
      if (!message || !bubble || !markdown || !block)
        throw new Error('The answer code block is missing.')
      const availableWidth = Math.min(message.getBoundingClientRect().width, 42 * 16)
      const bubbleStyle = getComputedStyle(bubble)
      // Compare fractional CSS geometry on both sides; clientWidth rounds to
      // integer pixels on displays with non-integer scaling.
      const contentWidth =
        bubble.getBoundingClientRect().width -
        Number.parseFloat(bubbleStyle.borderLeftWidth) -
        Number.parseFloat(bubbleStyle.borderRightWidth) -
        Number.parseFloat(bubbleStyle.paddingLeft) -
        Number.parseFloat(bubbleStyle.paddingRight)
      return {
        messageGap: Math.abs(availableWidth - bubble.getBoundingClientRect().width),
        // CSSOM serializes computed border widths with limited precision.
        contentGap: Math.abs(contentWidth - markdown.getBoundingClientRect().width) < 0.01 ? 0 : 1,
        blockGap: Math.abs(
          markdown.getBoundingClientRect().width - block.getBoundingClientRect().width
        ),
        pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
      }
    })
  await expect
    .poll(geometry)
    .toEqual({ messageGap: 0, contentGap: 0, blockGap: 0, pageOverflow: false })
  response.finish(`${'// A long source line '.repeat(40)}\n\`\`\``)
  await waitForReply(app.window, reply)
  await expect(codeBlock).toHaveAttribute('data-state', 'complete')
  await expect
    .poll(geometry)
    .toEqual({ messageGap: 0, contentGap: 0, blockGap: 0, pageOverflow: false })
  // The code's own viewport owns horizontal scrolling, not the message or page.
  expect(
    await codeBlock.locator('pre').evaluate((element) => {
      const viewport = element.parentElement
      if (!viewport) throw new Error('The code scroll viewport is missing.')
      viewport.scrollLeft = viewport.scrollWidth
      return viewport.scrollWidth > viewport.clientWidth && viewport.scrollLeft > 0
    })
  ).toBe(true)
})

test('user stops a streamed reply when reading partial output, then another message can be sent', async ({
  app,
  provider
}) => {
  const response = provider.enqueue({ type: 'text', text: 'Partial reply to stop.', hold: true })
  await composer(app.window).fill('Keep streaming')
  await app.window.getByRole('button', { name: 'Send message' }).click()
  await expect(assistantMessages(app.window).last().getByTestId('answer-content')).toHaveText(
    'Partial reply to stop.'
  )
  await app.window.getByRole('button', { name: 'Stop response' }).click()
  await response.closed
  await expect(app.window.getByRole('button', { name: 'Stop response' })).toBeHidden()
  await expect(composer(app.window)).toBeEditable()
  provider.enqueue({ type: 'text', text: 'The next turn completed.' })
  await expect(await sendUserMessage(app.window, 'Continue after stopping')).toContainText(
    'The next turn completed.'
  )
})

test('user retries a failed reply when the app restarts, then the user message is not duplicated', async ({
  app,
  provider
}, testInfo) => {
  provider.enqueue({ type: 'error', status: 401 })
  await composer(app.window).fill('Recover this request')
  await app.window.getByRole('button', { name: 'Send message' }).click()
  await expect(app.window.getByRole('alert')).toBeVisible()
  await expect(app.window.getByRole('button', { name: 'Try again' })).toBeVisible()
  const title = await app.window.locator('.conversation-row__title').first().innerText()
  await app.relaunch()
  await app.window
    .getByLabel('Sidebar', { exact: true })
    .getByRole('button', { name: title, exact: true })
    .click()
  await expect(app.window.getByRole('alert')).toBeVisible()
  await expect(app.window.getByRole('button', { name: 'Try again' })).toBeVisible()
  await app.window.screenshot({ path: testInfo.outputPath('failed-401-restored.png') })
  provider.enqueue({ type: 'text', text: 'Recovered answer.' })
  await app.window.getByRole('button', { name: 'Try again' }).click()
  await waitForReply(app.window, assistantMessages(app.window).last())
  await expect(app.window.getByRole('alert')).toHaveCount(0)
  await expect(
    app.window.getByTestId('answer-content').filter({ hasText: 'Recover this request' })
  ).toHaveCount(1)
  await expect(assistantMessages(app.window).last()).toContainText('Recovered answer.')
  await app.window.screenshot({ path: testInfo.outputPath('failed-401-recovered.png') })
})

test('user stops a response when waiting to retry, then only the next message reaches the provider', async ({
  app,
  provider
}, testInfo) => {
  const rejected = provider.enqueue({ type: 'error', status: 503, retryAfter: '4' })
  await composer(app.window).fill('Stop this retry')
  await app.window.getByRole('button', { name: 'Send message' }).click()
  await rejected.closed
  const retryDeadline = Date.now() + 4_000
  await expect(app.window.getByRole('status').filter({ hasText: 'Retrying' })).toBeVisible()
  await app.window.screenshot({ path: testInfo.outputPath('retry-after-wait.png') })
  await app.window.getByRole('button', { name: 'Stop response' }).click()
  await expect(app.window.getByRole('button', { name: 'Stop response' })).toBeHidden()
  await expect(composer(app.window)).toBeEditable()
  provider.enqueue({ type: 'text', text: 'The next message completed.' })
  await expect(await sendUserMessage(app.window, 'Continue after cancelled retry')).toContainText(
    'The next message completed.'
  )
  // Observe real requests past the original deadline; an immediate count cannot prove cancellation.
  await expect
    .poll(() => ({
      deadlinePassed: Date.now() >= retryDeadline,
      cancelledRequests: provider.requests.filter(
        (request) =>
          request.messages.findLast(({ role }) => role === 'user')?.content === 'Stop this retry'
      ).length
    }))
    .toEqual({ deadlinePassed: true, cancelledRequests: 1 })
  expect(provider.requests).toHaveLength(2)
  await app.window.screenshot({ path: testInfo.outputPath('retry-after-stopped-next-turn.png') })
})
