import type { ChatProviderMessage } from '@mico/ai-providers'
import type { SessionDatabase } from '@main/data/session-database'
import { toProviderReplayContext } from '../provider-messages'
import { type RunRow, type SessionEventLog } from './event-log'
import type { SessionToolJournal } from './tool-journal'

function getSessionReplay(
  database: SessionDatabase,
  eventLog: SessionEventLog,
  journal: SessionToolJournal,
  run: RunRow
): ChatProviderMessage[] {
  const checkpoint = eventLog.getTurnCheckpoint(run.turn_id)
  const throughSequence = checkpoint?.coverage.throughSequence ?? 0
  const summary: ChatProviderMessage[] = checkpoint
    ? [{ role: 'user', parts: [{ type: 'text', text: checkpoint.summary }] }]
    : []
  // SAFETY: the column list matches the declared RunRow fields exactly.
  const relevant = database.connection
    .prepare(
      `SELECT runs.id, runs.session_id, runs.turn_id, runs.attempt, runs.status FROM runs JOIN runtime_events e ON e.run_id = runs.id AND e.kind = 'run_started' WHERE runs.session_id = ? AND (runs.turn_id = ? AND runs.attempt < ? OR EXISTS (SELECT 1 FROM runs accepted JOIN runtime_events terminal ON terminal.run_id = accepted.id AND terminal.kind IN ('run_completed','run_cancelled') WHERE accepted.turn_id = runs.turn_id AND runs.attempt <= accepted.attempt AND terminal.session_sequence > ? AND terminal.session_sequence < (SELECT session_sequence FROM runtime_events WHERE run_id = ? AND kind = 'run_started'))) ORDER BY e.session_sequence`
    )
    .all(run.session_id, run.turn_id, run.attempt, throughSequence, run.id) as RunRow[]
  // Legacy assembly remains authoritative unless a checkpoint requires per-run
  // continuation ownership or this history contains the new journal.
  // SAFETY: reachable histories order run_started after the prior terminal event,
  // because the runtime blocks retrying an earlier failure once a later turn completes.
  if (
    !checkpoint &&
    !relevant.some((prior) =>
      journal.rows(prior.id).some((row) => row.kind === 'model_step_accepted')
    )
  )
    return eventLog.getReplayMessages(run)
  const messages: ChatProviderMessage[] = []
  const seenTurns = new Map<string, boolean>()
  for (const prior of relevant) {
    if (!seenTurns.has(prior.turn_id)) {
      messages.push(
        toProviderReplayContext(eventLog.getTurnUserMessage(prior.turn_id)),
        ...(eventLog.getTurnContext(prior.turn_id) ?? [])
      )
      const priorCheckpoint = checkpoint ? eventLog.getTurnCheckpoint(prior.turn_id) : undefined
      seenTurns.set(
        prior.turn_id,
        !checkpoint || priorCheckpoint?.coverage.throughSequence === throughSequence
      )
    }
    const sharesCheckpoint = seenTurns.get(prior.turn_id)
    // Responses continuation IDs inherit the entire provider chain, including any covered prefix.
    // Only IDs generated under this pin can trim its summary from subsequent requests.
    messages.push(
      ...journal.replay(prior.id).map((message) => {
        if (
          sharesCheckpoint ||
          message.role !== 'assistant' ||
          message.replay?.provider !== 'openai-responses'
        )
          return message
        const { replay: _continuation, ...retained } = message
        return retained
      })
    )
  }
  if (!seenTurns.has(run.turn_id))
    messages.push(
      toProviderReplayContext(eventLog.getTurnUserMessage(run.turn_id)),
      ...(eventLog.getTurnContext(run.turn_id) ?? [])
    )
  return [...summary, ...messages]
}

export { getSessionReplay }
