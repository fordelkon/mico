/**
 * The failure vocabulary for a chat turn, shared by the processes that
 * classify, persist, and present it. `process_interrupted` is the literal
 * persisted by recovery; the others are written by the turn orchestration.
 */
type TurnFailureCode =
  | 'provider_error'
  | 'step_limit'
  | 'token_limit'
  | 'aborted'
  | 'no_model'
  | 'process_interrupted'

type TurnFailure = {
  code: TurnFailureCode
  message: string
}

export type { TurnFailure, TurnFailureCode }
