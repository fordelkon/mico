import { expect, test } from '../fixtures/local-provider.fixture'
import { assistantMessages, composer, sendUserMessage, waitForReply } from '../utils/chat'

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

test('user retries a failed reply when the provider recovers, then the user message is not duplicated', async ({
  app,
  provider
}) => {
  provider.enqueue({ type: 'error', status: 401 })
  await composer(app.window).fill('Recover this request')
  await app.window.getByRole('button', { name: 'Send message' }).click()
  await expect(app.window.getByRole('alert')).toBeVisible()
  provider.enqueue({ type: 'text', text: 'Recovered answer.' })
  await app.window.getByRole('button', { name: 'Try again' }).click()
  await waitForReply(app.window, assistantMessages(app.window).last())
  await expect(app.window.getByRole('alert')).toHaveCount(0)
  await expect(
    app.window.getByTestId('answer-content').filter({ hasText: 'Recover this request' })
  ).toHaveCount(1)
  await expect(assistantMessages(app.window).last()).toContainText('Recovered answer.')
})
