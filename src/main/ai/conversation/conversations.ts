import { CodingAgent, type CodingAgentOptions } from '@mico/coding-agent'
import type {
  PermissionResponse,
  ExecutionProfileSnapshot,
  PersistedSession,
  SessionSummary
} from '@mico/coding-agent/contracts'
import type { SessionDatabase } from '@main/data/session-database'
import { SessionRuntimeService } from './runtime'
import { PermissionRequests } from './tool-approvals'

interface ConversationsOptions extends Omit<CodingAgentOptions, 'runtime' | 'requestApproval'> {
  database: SessionDatabase
  createId?: () => string
  now?: () => number
}

interface CreateSessionInput {
  title: string
  defaultProfile: ExecutionProfileSnapshot | null
  projectId?: string | null
  cwd?: string | null
}

/** Desktop composition owns SQLite sessions and window-scoped tool approvals. */
class Conversations extends CodingAgent {
  private readonly runtime: SessionRuntimeService
  private readonly permissions: PermissionRequests

  constructor({ database, createId, now, ...options }: ConversationsOptions) {
    const runtime = new SessionRuntimeService({ database, createId, now })
    const permissions = new PermissionRequests()
    super({
      ...options,
      runtime,
      requestApproval: permissions.request
    })
    this.runtime = runtime
    this.permissions = permissions
  }

  createSession(input: CreateSessionInput): SessionSummary {
    return this.runtime.createSession(input)
  }

  listSessions(): SessionSummary[] {
    return this.runtime.listSessions()
  }

  loadSession(sessionId: string): PersistedSession {
    return this.runtime.loadSession(sessionId)
  }

  renameSession(sessionId: string, title: string): SessionSummary {
    return this.runtime.renameSession(sessionId, title)
  }

  deleteSession(sessionId: string): void {
    this.assertNoAdmission(sessionId)
    this.runtime.deleteSession(sessionId)
  }

  respondToPermission(ownerId: string, response: PermissionResponse): void {
    this.permissions.respond(ownerId, response)
  }

  recoverInterruptedRuns(): number {
    return this.runtime.recoverInterruptedRuns()
  }
}

export { Conversations }
