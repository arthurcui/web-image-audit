import type { TokenRepository } from '../../application/auth.js';
import { workerStaleAfterMs } from '../../application/readiness.js';
import type { ReadinessStore } from '../../application/readiness.js';
import { defaultScan, parseScan } from '../../shared/scan.js';
import type { ScanOptions } from '../../shared/scan.js';
import type Database from 'better-sqlite3';
import { openSqlite } from './connection.js';
import { randomUUID } from 'node:crypto';
import type { AuditJob } from '../../application/jobs.js';
import { JobError } from '../../application/jobs.js';
import type { Claim, JobCursor, AuditRepository, WorkerQueue } from '../../application/jobs.js';
import type { Attempt, Failure, Progress } from '../../shared/jobs.js';
import type { AuditResult } from '../../shared/audit.js';

function decodeAuditResult(json: string): AuditResult {
  const stored = JSON.parse(json) as AuditResult & { coverage: { reasons?: string[] } };
  if (Array.isArray(stored.coverage.findings)) return stored;
  return {
    ...stored,
    coverage: {
      complete: stored.coverage.complete,
      findings: (stored.coverage.reasons ?? []).map((message) => ({
        code: 'legacy-notice',
        message,
      })),
    },
  };
}

interface Row {
  scan_json: string;
  id: string;
  owner_id: string;
  url: string;
  state: AuditJob['state'];
  attempts: number;
  max_attempts: number;
  created_at: number;
  updated_at: number;
  available_at: number;
  lease_until: number | null;
  progress_json: string;
  last_error_json: string | null;
  result_json: string | null;
}
const queued: Progress = { phase: 'queued', inspected: 0, total: null };
function job(row: Row): AuditJob {
  return {
    scan: parseScan(JSON.parse(row.scan_json)),
    id: row.id,
    ownerId: row.owner_id,
    url: row.url,
    state: row.state,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    availableAt: row.available_at,
    leaseUntil: row.lease_until,
    progress: JSON.parse(row.progress_json) as Progress,
    lastError: row.last_error_json ? (JSON.parse(row.last_error_json) as Failure) : null,
  };
}

/** Every state-changing operation is synchronous and completes before any network I/O. */
export class SqliteJobStore
  implements AuditRepository, WorkerQueue, TokenRepository, ReadinessStore
{
  private readonly db: Database.Database;
  constructor(
    path: string,
    private readonly now: () => number = Date.now,
  ) {
    this.db = openSqlite(path);
  }
  close() {
    this.db.close();
  }
  probeReadiness() {
    // Exercise the application schema and acquire a write lock without changing jobs.
    // This is an access probe, not a disk-integrity or durability guarantee.
    return this.db
      .transaction(() => {
        this.db.prepare('SELECT id FROM jobs LIMIT 1').get();
        this.db.prepare('UPDATE worker_heartbeats SET heartbeat_at=heartbeat_at WHERE 0').run();
        const now = this.now();
        const row = this.db
          .prepare(
            'SELECT 1 FROM worker_heartbeats WHERE heartbeat_at > ? AND heartbeat_at <= ? LIMIT 1',
          )
          .get(now - workerStaleAfterMs, now);
        return { workerReady: !!row };
      })
      .immediate();
  }
  recordWorkerHeartbeat(id: string) {
    this.db
      .transaction(() => {
        const now = this.now();
        this.db
          .prepare('DELETE FROM worker_heartbeats WHERE heartbeat_at <= ?')
          .run(now - workerStaleAfterMs);
        this.db
          .prepare(
            'INSERT INTO worker_heartbeats(worker_id,heartbeat_at) VALUES (?,?) ON CONFLICT(worker_id) DO UPDATE SET heartbeat_at=excluded.heartbeat_at',
          )
          .run(id, now);
      })
      .immediate();
  }
  removeWorkerHeartbeat(id: string) {
    this.db.prepare('DELETE FROM worker_heartbeats WHERE worker_id=?').run(id);
  }
  saveToken(hash: string, userId: string) {
    this.db
      .prepare('INSERT INTO bearer_tokens(token_hash,user_id,created_at) VALUES (?,?,?)')
      .run(hash, userId, this.now());
  }
  tokenUser(hash: string) {
    return (
      this.db.prepare('SELECT user_id FROM bearer_tokens WHERE token_hash=?').get(hash) as
        { user_id: string } | undefined
    )?.user_id;
  }
  private requireOwner(ownerId: string) {
    if (typeof ownerId !== 'string' || ownerId.trim().length === 0)
      throw new TypeError('Owner ID is required');
  }
  private row(id: string, ownerId: string) {
    this.requireOwner(ownerId);
    return this.db.prepare('SELECT * FROM jobs WHERE id=? AND owner_id=?').get(id, ownerId) as
      Row | undefined;
  }
  get(id: string, ownerId: string) {
    const row = this.row(id, ownerId);
    return row ? job(row) : undefined;
  }
  list(limit: number, ownerId: string, before?: JobCursor) {
    this.requireOwner(ownerId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new RangeError('limit must be 1..100');
    if (before) {
      return (
        this.db
          .prepare(
            'SELECT * FROM jobs WHERE owner_id=? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC,id DESC LIMIT ?',
          )
          .all(ownerId, before.createdAt, before.createdAt, before.id, limit) as Row[]
      ).map(job);
    }
    return (
      this.db
        .prepare('SELECT * FROM jobs WHERE owner_id=? ORDER BY created_at DESC,id DESC LIMIT ?')
        .all(ownerId, limit) as Row[]
    ).map(job);
  }
  results(id: string, ownerId: string) {
    // One read transaction supplies a consistent status/result/history snapshot.
    return this.db.transaction(() => {
      const row = this.row(id, ownerId);
      if (!row) return undefined;
      const attempts = (
        this.db
          .prepare(
            'SELECT attempt, started_at, ended_at, outcome, failure_json FROM job_attempts WHERE job_id = ? ORDER BY attempt',
          )
          .all(id) as Array<{
          attempt: number;
          started_at: number;
          ended_at: number | null;
          outcome: string | null;
          failure_json: string | null;
        }>
      ).map((a): Attempt => ({
        attempt: a.attempt,
        startedAt: a.started_at,
        endedAt: a.ended_at,
        outcome: a.outcome,
        failure: a.failure_json ? (JSON.parse(a.failure_json) as Failure) : null,
      }));
      return {
        job: job(row),
        result: row.result_json ? decodeAuditResult(row.result_json) : null,
        attempts,
      };
    })();
  }
  create(url: string, key: string | undefined, ownerId: string, scan: ScanOptions = defaultScan) {
    this.requireOwner(ownerId);
    const encodedScan = JSON.stringify(parseScan(scan));
    const scopedKey = key === undefined ? undefined : JSON.stringify([ownerId, key]);
    return this.db
      .transaction(() => {
        if (key !== undefined) {
          const existing = this.db
            .prepare('SELECT * FROM jobs WHERE idempotency_key = ? AND owner_id = ?')
            .get(scopedKey!, ownerId) as Row | undefined;
          if (existing) {
            if (existing.url !== url || existing.scan_json !== encodedScan)
              throw new JobError(
                'idempotency_conflict',
                'Idempotency-Key already belongs to a different audit payload',
              );
            return { job: job(existing), replayed: true };
          }
        }
        const id = randomUUID();
        const now = this.now();
        this.db
          .prepare(
            `INSERT INTO jobs
        (id,url,idempotency_key,state,max_attempts,created_at,updated_at,available_at,progress_json,owner_id,scan_json)
        VALUES (?,?,?,'queued',3,?,?,?,?,?,?)`,
          )
          .run(
            id,
            url,
            scopedKey ?? null,
            now,
            now,
            now,
            JSON.stringify(queued),
            ownerId,
            encodedScan,
          );
        return { job: this.get(id, ownerId)!, replayed: false };
      })
      .immediate();
  }
  private owns(claim: Claim, now: number): boolean {
    return !!this.db
      .prepare(
        `SELECT 1 FROM jobs WHERE id = ? AND state = 'running'
      AND lease_token = ? AND lease_until > ?`,
      )
      .get(claim.job.id, claim.token, now);
  }
  claim(leaseMs: number): Claim | undefined {
    this.checkLease(leaseMs);
    return this.db
      .transaction(() => {
        const now = this.now(); // Read after acquiring the write lock.
        // Bounded recovery work per poll keeps the write transaction short.
        const expired = this.db
          .prepare(
            `SELECT * FROM jobs WHERE state='running' AND lease_until <= ?
        ORDER BY lease_until LIMIT 100`,
          )
          .all(now) as Row[];
        for (const row of expired) {
          const failure: Failure = {
            code: 'lease_expired',
            message: 'Worker stopped renewing its lease',
            at: now,
            retryable: true,
          };
          const exhausted = row.attempts >= row.max_attempts;
          this.db
            .prepare(
              `UPDATE job_attempts SET ended_at=?,outcome='lease_expired',failure_json=?
          WHERE job_id=? AND attempt=?`,
            )
            .run(now, JSON.stringify(failure), row.id, row.attempts);
          this.db
            .prepare(
              `UPDATE jobs SET state=?,lease_token=NULL,lease_until=NULL,updated_at=?,available_at=?,
          last_error_json=?,result_json=NULL,progress_json=? WHERE id=?`,
            )
            .run(
              exhausted ? 'failed' : 'queued',
              now,
              now,
              JSON.stringify(failure),
              JSON.stringify(exhausted ? { phase: 'failed', inspected: 0, total: null } : queued),
              row.id,
            );
        }
        const row = this.db
          .prepare(
            `SELECT * FROM jobs WHERE state='queued' AND available_at <= ?
        AND attempts < max_attempts ORDER BY available_at,created_at,id LIMIT 1`,
          )
          .get(now) as Row | undefined;
        if (!row) return undefined;
        const token = randomUUID();
        this.db
          .prepare(
            `UPDATE jobs SET state='running',attempts=attempts+1,lease_token=?,lease_until=?,
        updated_at=?,progress_json=?,result_json=NULL WHERE id=?`,
          )
          .run(
            token,
            now + leaseMs,
            now,
            JSON.stringify({ phase: 'fetching-page', inspected: 0, total: null }),
            row.id,
          );
        this.db
          .prepare('INSERT INTO job_attempts(job_id,attempt,started_at) VALUES (?,?,?)')
          .run(row.id, row.attempts + 1, now);
        return { job: this.get(row.id, row.owner_id)!, token };
      })
      .immediate();
  }
  private checkLease(ms: number) {
    if (!Number.isSafeInteger(ms) || ms < 1 || ms > 3_600_000)
      throw new RangeError('Invalid lease duration');
  }
  heartbeat(claim: Claim, leaseMs: number) {
    this.checkLease(leaseMs);
    return this.db
      .transaction(() => {
        const now = this.now();
        return (
          this.db
            .prepare(
              `UPDATE jobs SET lease_until=?,updated_at=?
        WHERE id=? AND state='running' AND lease_token=? AND lease_until > ?`,
            )
            .run(now + leaseMs, now, claim.job.id, claim.token, now).changes === 1
        );
      })
      .immediate();
  }
  progress(claim: Claim, progress: Progress) {
    const encoded = JSON.stringify(progress);
    return this.db
      .transaction(() => {
        const now = this.now();
        return (
          this.db
            .prepare(
              `UPDATE jobs SET progress_json=?,updated_at=?
        WHERE id=? AND state='running' AND lease_token=? AND lease_until > ?`,
            )
            .run(encoded, now, claim.job.id, claim.token, now).changes === 1
        );
      })
      .immediate();
  }
  complete(claim: Claim, result: AuditResult) {
    const encoded = JSON.stringify(result); // Serialize before acquiring the write lock.
    return this.db
      .transaction(() => {
        const now = this.now();
        if (!this.owns(claim, now)) return false;
        this.db
          .prepare(
            `UPDATE jobs SET state='completed',result_json=?,progress_json=?,updated_at=?,
        lease_token=NULL,lease_until=NULL WHERE id=?`,
          )
          .run(
            encoded,
            JSON.stringify({
              phase: 'completed',
              inspected: result.resources.length,
              total: result.resources.length,
            }),
            now,
            claim.job.id,
          );
        this.db
          .prepare(
            `UPDATE job_attempts SET ended_at=?,outcome='completed' WHERE job_id=? AND attempt=?`,
          )
          .run(now, claim.job.id, claim.job.attempts);
        return true;
      })
      .immediate();
  }
  fail(claim: Claim, failure: Omit<Failure, 'at'>, retryDelayMs: number, result?: AuditResult) {
    if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 86_400_000) {
      throw new RangeError('Retry delay must be between 0 and one day');
    }
    const encoded = result ? JSON.stringify(result) : null;
    return this.db
      .transaction(() => {
        const now = this.now();
        if (!this.owns(claim, now)) return false;
        const retry = failure.retryable && claim.job.attempts < claim.job.maxAttempts;
        const error = JSON.stringify({ ...failure, at: now });
        this.db
          .prepare(
            `UPDATE jobs SET state=?,updated_at=?,available_at=?,last_error_json=?,
        result_json=?,progress_json=?,lease_token=NULL,lease_until=NULL WHERE id=?`,
          )
          .run(
            retry ? 'queued' : 'failed',
            now,
            now + retryDelayMs,
            error,
            retry ? null : encoded,
            JSON.stringify(retry ? queued : { phase: 'failed', inspected: 0, total: null }),
            claim.job.id,
          );
        this.db
          .prepare(
            `UPDATE job_attempts SET ended_at=?,outcome=?,failure_json=? WHERE job_id=? AND attempt=?`,
          )
          .run(now, retry ? 'retry' : 'failed', error, claim.job.id, claim.job.attempts);
        return true;
      })
      .immediate();
  }
}
