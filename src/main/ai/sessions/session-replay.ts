import type { ChatProviderMessage } from '@mico/ai-providers'
import type { SessionDatabase } from '../../data/session-database'
import { toProviderReplayContext } from '../chat/conversation-context'
import { type RunRow, type SessionEventLog } from './session-event-log'
import type { SessionToolJournal } from './session-tool-journal'
function getSessionReplay(
  database: SessionDatabase,
  eventLog: SessionEventLog,
  journal: SessionToolJournal,
  run: RunRow
): ChatProviderMessage[] {
  const runId = run.id
  let messages = eventLog.getReplayMessages(run)
  // SAFETY: schema-owned event writers and fixed SQL columns establish this stored row shape.
  const relevant = database.connection
    .prepare(
      `SELECT runs.id FROM runs JOIN runtime_events e ON e.run_id = runs.id AND e.kind = 'run_started' WHERE runs.session_id = ? AND (runs.turn_id = ? AND runs.attempt < ? OR EXISTS (SELECT 1 FROM runs accepted JOIN runtime_events terminal ON terminal.run_id = accepted.id AND terminal.kind IN ('run_completed','run_cancelled') WHERE accepted.turn_id = runs.turn_id AND runs.attempt <= accepted.attempt AND terminal.session_sequence < (SELECT session_sequence FROM runtime_events WHERE run_id = ? AND kind = 'run_started'))) ORDER BY e.session_sequence`
    )
    .all(run.session_id, run.turn_id, run.attempt, runId) as { id: string }[]
  // Legacy assembly remains authoritative unless this history contains the new journal.
  if (
    !relevant.some((prior) =>
      journal.rows(prior.id).some((row) => row.kind === 'model_step_accepted')
    )
  )
    return messages
  messages = []
  const seenTurns = new Set<string>()
  for (const prior of relevant) {
    const priorRun = getRunRow(prior.id)
    if (!seenTurns.has(priorRun.turn_id)) {
      messages.push(
        toProviderReplayContext(eventLog.getTurnUserMessage(priorRun.turn_id)),
        ...(eventLog.getTurnContext(priorRun.turn_id) ?? [])
      )
      seenTurns.add(priorRun.turn_id)
    }
    messages.push(...journal.replay(prior.id))
  }
  if (!seenTurns.has(run.turn_id))
    messages.push(
      toProviderReplayContext(eventLog.getTurnUserMessage(run.turn_id)),
      ...(eventLog.getTurnContext(run.turn_id) ?? [])
    )
  return messages

  function getRunRow(id: string): RunRow {
    // SAFETY: fixed runs columns have the schema-owned RunRow shape.
    const row = database.connection.prepare('SELECT * FROM runs WHERE id = ?').get(id) as
      | RunRow
      | undefined
    if (!row) throw new Error('Run does not exist.')
    return row
  }
}
export { getSessionReplay }
