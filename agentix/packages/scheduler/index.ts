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

  /**
   * Registers (or replaces) the handler that executes jobs of a given type.
   * WHY: the scheduler is type-driven — a job only runs when its type has a handler, so registration is the opt-in that makes a job type runnable.
   * @param type Job type string, matched exactly against the `type` passed to schedule().
   * @returns Nothing.
   * @throws Never throws.
   * Maps to: internal — Scheduler._processJobs / _processRecurring (handler lookup).
   * Side effects: mutates the handler map; re-registering silently replaces the previous handler.
   */
  registerHandler(type: string, handler: (job: Job) => Promise<void>): void {
    this.handlers.set(type, handler);
  }

  /**
   * Removes the handler for a job type; pending jobs of that type are then skipped, not failed.
   * WHY: teardown/disable path for a job type without cancelling the queued jobs themselves.
   * @returns Nothing; unknown types are a silent no-op.
   * @throws Never throws.
   * Maps to: internal — Scheduler._processJobs (jobs with no handler are skipped).
   * Side effects: mutates the handler map.
   */
  unregisterHandler(type: string): void {
    this.handlers.delete(type);
  }

  /**
   * Persists a one-time job for execution at or after `scheduledAt` and returns its id.
   * WHY: durable scheduling — jobs survive restarts because they live in SQLite, not in memory.
   * @param type Handler type; must be registered before the run time or the job is skipped every tick and never fails.
   * @param payload JSON-serializable job data; stored as JSON, so non-serializable values (functions, BigInt, cycles) throw or corrupt at insert.
   * @param options scheduledAt is epoch seconds (default now); maxAttempts/backoffMs/backoffMultiplier/timeoutMs default to 3 / 1000 ms / 2.0x / 30000 ms. A scheduledAt of 0 falls back to now.
   * @returns The generated job id.
   * @throws Throws on DB errors or unserializable payloads.
   * Maps to: internal — Scheduler._processJobs (execution); event onCompleteEvent / onFailureEvent on completion.
   * Side effects: inserts a row into scheduler_jobs (disk I/O).
   */
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

  /**
   * Registers an in-memory recurring job that fires every `intervalMs`, starting on the next tick.
   * WHY: polling/heartbeat work that needs no durability — unlike schedule(), this never touches the DB.
   * @param intervalMs Period in milliseconds; converted to epoch seconds internally, so sub-second intervals collapse to firing every scheduler tick.
   * @returns The generated recurring-job id.
   * @throws Never throws (no I/O).
   * Maps to: internal — Scheduler._processRecurring.
   * Side effects: mutates the in-memory recurringJobs map only. Recurring jobs are LOST on restart and are invisible to listJobs()/getStatus(); cancel() is the only way to stop one.
   */
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

  /**
   * Cancels a pending one-time job and/or a recurring job by id.
   * WHY: the operator's stop button — a cancelled job must never run, even if its time has come.
   * @param jobId Id from schedule() or scheduleRecurring(); unknown ids are a silent no-op.
   * @returns Nothing.
   * @throws Throws on DB errors.
   * Maps to: internal — Scheduler._processJobs (only pending jobs are picked up, so cancelling a running job does not stop it).
   * Side effects: updates scheduler_jobs to 'cancelled' (only when still pending) and/or removes the recurring entry. A running job is NOT interrupted.
   */
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

  /**
   * Fetches one job's current state from the DB by id.
   * WHY: the status/read path for operators and for completion handlers that need the job record.
   * @returns The job, or null when no row matches. Recurring jobs are not in the DB and always return null.
   * @throws Throws on DB errors or when a stored payload is not valid JSON.
   * Maps to: internal — Scheduler.listJobs (single-row form of the same read).
   * Side effects: none (read-only DB query).
   */
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

  /**
   * Lists one-time jobs, optionally filtered by type/status, oldest scheduled first.
   * WHY: the operator's queue view — what is pending, what failed, what is stuck.
   * @param filter Optional exact-match type/status; an unknown status string yields an empty list, not an error.
   * @returns Up to 100 jobs ordered by scheduled_at ascending; empty array when nothing matches. Recurring jobs are never included.
   * @throws Throws on DB errors or corrupt stored payload JSON.
   * Maps to: internal — Scheduler.getStatus (list form of the same read).
   * Side effects: none (read-only).
   */
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

  /**
   * Starts the polling loop that executes due jobs and recurring jobs.
   * WHY: scheduling is pull-based — nothing runs until the loop ticks, so start() is what arms the scheduler after handlers are registered.
   * @param intervalMs Tick period in ms, default 5000. The tick awaits both processors serially, so a slow handler delays the next tick; ticks are not serialized against each other, so an overrunning tick can overlap the next one.
   * @returns Nothing; resolves once the timer is armed, not after any job runs.
   * @throws Never throws.
   * Maps to: internal — Scheduler.stop (teardown); event onCompleteEvent / onFailureEvent emitted per one-time job.
   * Side effects: starts a repeating timer; calling start() twice is a no-op (the second call returns immediately).
   */
  async start(intervalMs: number = 5000): Promise<void> {
    if (this.running) return;
    this.running = true;

    this.timer = setInterval(async () => {
      await this._processJobs();
      await this._processRecurring();
    }, intervalMs);
  }

  /**
   * Stops the polling loop; already-running handlers are not interrupted.
   * WHY: graceful shutdown — no new jobs start, while in-flight work finishes on its own.
   * @returns Nothing; safe to call when not running.
   * @throws Never throws.
   * Maps to: internal — Scheduler.start.
   * Side effects: clears the timer and flips `running` off. In-flight handler promises keep running to completion.
   */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Runs one tick of the one-time queue: claims up to 10 due pending jobs, executes them with timeouts, and retries or fails them.
   * WHY: the core of the scheduler — claim (pending→running), run, then complete/fail/requeue with exponential backoff, all in DB state so a crash mid-run is recoverable.
   * @returns Nothing; all outcomes are recorded in scheduler_jobs.
   * @throws Throws on DB errors (no outer guard); the setInterval caller does not catch, so a DB outage surfaces as an unhandled rejection.
   * Maps to: internal — Scheduler.start (tick driver); event onCompleteEvent / onFailureEvent.
   * Side effects: DB reads/writes (status transitions, attempt counts, backoff rescheduling), emits completion/failure events, deletes terminal jobs older than 24h. Jobs with no registered handler are skipped silently and stay pending forever.
   */
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

  /**
   * Runs one tick of the in-memory recurring jobs, firing each active job whose time has come.
   * WHY: the recurring half of the scheduler — fire-and-forget periodic work with no DB row per run.
   * @returns Nothing; handler failures are swallowed and the next run is still scheduled. No completion/failure events are emitted for recurring runs.
   * @throws Never throws — per-job errors are caught and ignored.
   * Maps to: internal — Scheduler.start (tick driver).
   * Side effects: advances each fired job's nextRunAt; runs handlers. A handler slower than the interval can double-fire on overlapping ticks (nextRunAt advances only after the handler returns).
   */
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

  /**
   * Runs a job handler with a hard timeout.
   * WHY: a stuck handler must not wedge the scheduler tick — the timeout converts a hang into a catchable failure the retry logic can act on.
   * @param timeoutMs Timeout in milliseconds; a timeout rejects even if the handler later completes.
   * @returns Nothing on success.
   * @throws Rejects with the handler's error, or a timeout Error naming the job id.
   * Maps to: internal — Scheduler._processJobs / _processRecurring (only callers).
   * Side effects: starts a timer (cleared on settle). NOTE: on timeout the handler keeps running in the background — the timeout only rejects the promise, it does not abort the work.
   */
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

  /**
   * Returns the process-wide singleton Scheduler, creating it on first use.
   * WHY: one scheduler per process — two loops would double-execute due jobs.
   * @returns The singleton instance.
   * @throws Never throws.
   * Maps to: internal — getScheduler() (module-level accessor).
   * Side effects: creates the singleton on first call.
   */
  static getInstance(): Scheduler {
    if (!_instance) {
      _instance = new Scheduler();
    }
    return _instance;
  }

  /**
   * Stops and drops the singleton (test teardown / restart path).
   * WHY: tests and restarts need a clean scheduler without a dangling timer.
   * @returns Nothing; a no-op when no instance exists.
   * @throws Never throws.
   * Maps to: internal — Scheduler.getInstance.
   * Side effects: stops the polling loop and nulls the singleton; a subsequent getInstance() builds a fresh scheduler with no handlers and no recurring jobs.
   */
  static resetInstance(): void {
    if (_instance) {
      _instance.stop();
      _instance = null;
    }
  }
}

/**
 * Returns the process-wide singleton Scheduler.
 * WHY: the module-level accessor every service/CLI entry point uses instead of constructing schedulers directly.
 * @returns The singleton instance.
 * @throws Never throws.
 * Maps to: internal — Scheduler.getInstance.
 * Side effects: creates the singleton on first call.
 */
export function getScheduler(): Scheduler {
  return Scheduler.getInstance();
}
