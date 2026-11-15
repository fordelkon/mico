import type { AgentStep, ExecutionJournal } from '@mico/agent-core'
import type { ChatProviderMessage } from '@mico/ai-providers'
import type {
  ChatMessage,
  ExecutionProfileSnapshot,
  SessionSummary,
  TurnFailure
} from '../contracts'

type ProviderUserMessage = Extract<ChatProviderMessage, { role: 'system' | 'user' }> & {
  role: 'user'
}

interface TurnContextSource {
  cwd: string | null
  projectId: string | null
  replayMessages: ChatProviderMessage[]
  /** Undefined until accepted; an accepted empty snapshot must also survive retry. */
  contextMessages: ProviderUserMessage[] | undefined
}

interface PendingTurnContext extends TurnContextSource {
  existing: boolean
  profile: ExecutionProfileSnapshot | undefined
}

/** A single accepted turn with synchronous acknowledgements for execution facts. */
interface TurnRunHandle extends ExecutionJournal, TurnContextSource {
  profile: ExecutionProfileSnapshot
  shouldGenerateTitle: boolean
  recordContext(messages: ProviderUserMessage[]): void
  recordStep(this: void, step: AgentStep): void
  complete(assistant: ChatMessage): void
  fail(failure: TurnFailure, assistant?: ChatMessage): void
  cancel(assistant?: ChatMessage): void
}

interface CheckpointSource {
  throughSequence: number
  sourceDigest: string
  messages: ChatProviderMessage[]
}

type CompactionNoticeReason =
  | 'rejected'
  | 'source_changed'
  | 'profile_changed'
  | 'cancelled'
  | 'failed'

interface CheckpointReference {
  sessionId: string
  coverage: { throughSequence: number }
  sourceDigest: string
}

/** Persistence supplied by the host for turn admission, recovery, and compaction. */
interface SessionStore {
  previewTurn(sessionId: string, requestId: string, userMessage: ChatMessage): PendingTurnContext
  beginTurn(input: {
    sessionId: string
    requestId: string
    userMessage: ChatMessage
    profile: ExecutionProfileSnapshot
    retry: boolean
    retryRunId?: string
  }): TurnRunHandle
  getRetryProfile(sessionId: string, retryRunId?: string): ExecutionProfileSnapshot
  getDefaultProfile(sessionId: string): ExecutionProfileSnapshot | null
  updateDefaultProfile(sessionId: string, profile: ExecutionProfileSnapshot): void
  updateDefaultProfileIfCurrent(
    sessionId: string,
    expected: ExecutionProfileSnapshot | null,
    profile: ExecutionProfileSnapshot
  ): void
  renameSessionIfCurrentTitle(
    sessionId: string,
    currentTitle: string,
    title: string
  ): SessionSummary | null
  beginCompaction(sessionId: string): void
  endCompaction(sessionId: string): void
  getLatestCheckpointCoverage(sessionId: string): number
  /** Optionally select an earlier completed prefix; never go behind the latest checkpoint. */
  getCompactionSource(
    sessionId: string,
    options?: { beforeSequence: number }
  ): CheckpointSource | null
  acceptContextCheckpoint(
    input: CheckpointReference & {
      summary: string
      trigger: 'manual' | 'auto'
    }
  ): { checkpointEventId: string }
  recordCompactionNotice(
    input: CheckpointReference & {
      reason: CompactionNoticeReason
      message: string
    }
  ): void
}

export type {
  CompactionNoticeReason,
  PendingTurnContext,
  ProviderUserMessage,
  SessionStore,
  TurnRunHandle
}
