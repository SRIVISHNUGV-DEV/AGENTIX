import { runQuery, runSingle, runExecute } from '@agentix/database';
import { getEventBus } from '@agentix/eventbus';
import { generateId } from '@agentix/utils';

export interface Job {
  id: string;
  type: string;
  payload: unknown;
  scheduledAt: number;
  maxAttempts: number;
  attempts: number;
  backoffMs: number;
  backoffMultiplier: number;
  timeoutMs: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  onCompleteEvent?: string;
  onFailureEvent?: string;
  createdAt: number;
  lastAttemptAt?: number;
}

export interface RecurringJob {
  id: string;
  type: string;
  payload: unknown;
  intervalMs: number;
  nextRunAt: number;
  maxAttempts: number;
  status: 'active' | 'paused' | 'cancelled';
  onCompleteEvent?: string;
  onFailureEvent?: string;
}

let _instance: Scheduler | null = null;

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private running: boolean = false;
  private handlers: Map<string, (job: Job) => Promise<void>> = new Map();
  private recurringJobs: Map<string, RecurringJob> = new Map();

  registerHandler(type: string, handler: (job: Job) => Promise<void>): void {
    this.handlers.set(type, handler);
  }

  unregisterHandler(type: string): void {
    this.handlers.delete(type);
  }

  async schedule(type: string, payload: unknown, options?: {
    scheduledAt?: number;
    maxAttempts?: number;
    backoffMs?: number;
    backoffMultiplier?: number;
    timeoutMs?: number;
    onCompleteEvent?: string;
    onFailureEvent?: string;
  }): Promise<string> {
    const id = generateId();
    const now = Math.floor(Date.now() / 1000);

    runExecute(
      `INSERT INTO scheduler_jobs (job_id, job_type, payload_json, scheduled_at, max_attempts, attempts, backoff_ms, backoff_multiplier, timeout_ms, status, on_complete_event, on_failure_event, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'pending', ?, ?, ?)`,
      id,
      type,
      JSON.stringify(payload),
      options?.scheduledAt || now,
      options?.maxAttempts || 3,
      options?.backoffMs || 1000,
      options?.backoffMultiplier || 2.0,
      options?.timeoutMs || 30000,
      options?.onCompleteEvent || null,
      options?.onFailureEvent || null,
      now
    );

    return id;
  }

  async scheduleRecurring(type: string, payload: unknown, intervalMs: number, options?: {
    onCompleteEvent?: string;
    onFailureEvent?: string;
  }): Promise<string> {
    const id = generateId();
    const now = Math.floor(Date.now() / 1000);

    this.recurringJobs.set(id, {
      id,
      type,
      payload,
      intervalMs,
      nextRunAt: now,
      maxAttempts: 3,
      status: 'active',
      onCompleteEvent: options?.onCompleteEvent,
      onFailureEvent: options?.onFailureEvent,
    });

    return id;
  }

  cancel(jobId: string): void {
    runExecute(
      `UPDATE scheduler_jobs SET status = 'cancelled' WHERE job_id = ? AND status = 'pending'`,
      jobId
    );

    const recurring = this.recurringJobs.get(jobId);
    if (recurring) {
      recurring.status = 'cancelled';
      this.recurringJobs.delete(jobId);
    }
  }

  getStatus(jobId: string): Job | null {
    const row = runSingle(
      'SELECT * FROM scheduler_jobs WHERE job_id = ?',
      jobId
    ) as Record<string, unknown> | undefined;
    if (!row) return null;

    return {
      id: row.job_id as string,
      type: row.job_type as string,
      payload: JSON.parse(row.payload_json as string),
      scheduledAt: row.scheduled_at as number,
      maxAttempts: row.max_attempts as number,
      attempts: row.attempts as number,
      backoffMs: row.backoff_ms as number,
      backoffMultiplier: row.backoff_multiplier as number,
      timeoutMs: row.timeout_ms as number,
      status: row.status as Job['status'],
      onCompleteEvent: (row.on_complete_event as string) || undefined,
      onFailureEvent: (row.on_failure_event as string) || undefined,
      createdAt: row.created_at as number,
      lastAttemptAt: (row.last_attempt_at as number) || undefined,
    };
  }

  listJobs(filter?: { type?: string; status?: string }): Job[] {
    let sql = 'SELECT * FROM scheduler_jobs WHERE 1=1';
    const params: unknown[] = [];

    if (filter?.type) {
      sql += ' AND job_type = ?';
      params.push(filter.type);
    }
    if (filter?.status) {
      sql += ' AND status = ?';
      params.push(filter.status);
    }

    sql += ' ORDER BY scheduled_at ASC LIMIT 100';

    const rows = runQuery(sql, ...params) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.job_id as string,
      type: row.job_type as string,
      payload: JSON.parse(row.payload_json as string),
      scheduledAt: row.scheduled_at as number,
      maxAttempts: row.max_attempts as number,
      attempts: row.attempts as number,
      backoffMs: row.backoff_ms as number,
      backoffMultiplier: row.backoff_multiplier as number,
      timeoutMs: row.timeout_ms as number,
      status: row.status as Job['status'],
      onCompleteEvent: (row.on_complete_event as string) || undefined,
      onFailureEvent: (row.on_failure_event as string) || undefined,
      createdAt: row.created_at as number,
      lastAttemptAt: (row.last_attempt_at as number) || undefined,
    }));
  }

  async start(intervalMs: number = 5000): Promise<void> {
    if (this.running) return;
    this.running = true;

    this.timer = setInterval(async () => {
      await this._processJobs();
      await this._processRecurring();
    }, intervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async _processJobs(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const jobs = runQuery(
      `SELECT * FROM scheduler_jobs WHERE status = 'pending' AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT 10`,
      now
    ) as Record<string, unknown>[];

    for (const row of jobs) {
      const job: Job = {
        id: row.job_id as string,
        type: row.job_type as string,
        payload: JSON.parse(row.payload_json as string),
        scheduledAt: row.scheduled_at as number,
        maxAttempts: row.max_attempts as number,
        attempts: row.attempts as number,
        backoffMs: row.backoff_ms as number,
        backoffMultiplier: row.backoff_multiplier as number,
        timeoutMs: row.timeout_ms as number,
        status: 'pending',
        onCompleteEvent: (row.on_complete_event as string) || undefined,
        onFailureEvent: (row.on_failure_event as string) || undefined,
        createdAt: row.created_at as number,
      };

      const handler = this.handlers.get(job.type);
      if (!handler) continue;

      runExecute(
        `UPDATE scheduler_jobs SET status = 'running', last_attempt_at = ?, attempts = attempts + 1 WHERE job_id = ?`,
        now, job.id
      );

      try {
        await this._runWithTimeout(handler, job, job.timeoutMs);

        runExecute(
          `UPDATE scheduler_jobs SET status = 'completed' WHERE job_id = ?`,
          job.id
        );

        if (job.onCompleteEvent) {
          try {
            getEventBus().emit({ type: job.onCompleteEvent, jobId: job.id } as any);
          } catch {}
        }
      } catch (err: unknown) {
        const attempts = (job.attempts || 0) + 1;

        if (attempts >= job.maxAttempts) {
          runExecute(
            `UPDATE scheduler_jobs SET status = 'failed', last_attempt_at = ? WHERE job_id = ?`,
            now, job.id
          );

          if (job.onFailureEvent) {
            try {
              getEventBus().emit({
                type: job.onFailureEvent,
                jobId: job.id,
                error: (err as Error).message,
              } as any);
            } catch {}
          }
        } else {
          const nextAt = now + Math.floor(job.backoffMs * Math.pow(job.backoffMultiplier, attempts - 1) / 1000);
          runExecute(
            `UPDATE scheduler_jobs SET status = 'pending', scheduled_at = ? WHERE job_id = ?`,
            nextAt, job.id
          );
        }
      }
    }

    // Clean up completed/failed/cancelled jobs older than 24h
    const cutoff = now - 86400;
    runExecute(
      `DELETE FROM scheduler_jobs WHERE status IN ('completed', 'failed', 'cancelled') AND created_at < ?`,
      cutoff
    );
  }

  private async _processRecurring(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    for (const [id, job] of this.recurringJobs) {
      if (job.status !== 'active') continue;
      if (now < job.nextRunAt) continue;

      const handler = this.handlers.get(job.type);
      if (!handler) continue;

      const oneTimeJob: Job = {
        id: `${id}_${now}`,
        type: job.type,
        payload: job.payload,
        scheduledAt: now,
        maxAttempts: job.maxAttempts,
        attempts: 0,
        backoffMs: 1000,
        backoffMultiplier: 2,
        timeoutMs: 60000,
        status: 'pending',
        createdAt: now,
      };

      try {
        await this._runWithTimeout(handler, oneTimeJob, 60000);
      } catch {}

      job.nextRunAt = now + Math.floor(job.intervalMs / 1000);
    }
  }

  private async _runWithTimeout(
    handler: (job: Job) => Promise<void>,
    job: Job,
    timeoutMs: number
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Job ${job.id} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      handler(job)
        .then(() => {
          clearTimeout(timer);
          resolve();
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  static getInstance(): Scheduler {
    if (!_instance) {
      _instance = new Scheduler();
    }
    return _instance;
  }

  static resetInstance(): void {
    if (_instance) {
      _instance.stop();
      _instance = null;
    }
  }
}

export function getScheduler(): Scheduler {
  return Scheduler.getInstance();
}
