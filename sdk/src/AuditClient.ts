import axios from "axios"

export type AuditAction =
  | "agent.init"
  | "credential.register"
  | "credential.revoke"
  | "session.create.local"
  | "session.create.remote"
  | "proof.generate.local"
  | "proof.generate.remote"
  | "proof.verify.local"
  | "proof.verify.remote"
  | "wallet.create"
  | "agent.register"
  | "proof.fetch.merkle"

export interface AuditEvent {
  action: AuditAction
  resourceType: string
  resourceId?: string
  agentId?: number
  orgId?: number
  details?: Record<string, unknown>
  timestamp?: number
}

export class AuditClient {
  private api: string
  private orgId: number | null = null
  private agentId: number | null = null
  private queue: AuditEvent[] = []
  private syncing = false

  constructor(api: string) {
    this.api = api
  }

  setContext(orgId: number, agentId?: number) {
    this.orgId = orgId
    if (agentId !== undefined) this.agentId = agentId
  }

  log(event: AuditEvent) {
    this.queue.push({
      ...event,
      timestamp: event.timestamp ?? Date.now(),
    })
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0 || this.syncing) return
    this.syncing = true
    try {
      const batch = this.queue.splice(0)
      await axios.post(`${this.api}/audit/events`, {
        events: batch,
        orgId: this.orgId,
        agentId: this.agentId,
      })
    } catch {
      this.queue.unshift(...this.queue.splice(0))
    } finally {
      this.syncing = false
    }
  }

  getPendingCount(): number {
    return this.queue.length
  }

  getPending(): AuditEvent[] {
    return [...this.queue]
  }
}
