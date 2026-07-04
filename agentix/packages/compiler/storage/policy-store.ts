import { OptimizedPolicy } from '../types/policy';
import { generateId } from '@agentix/utils';
import { runQuery, runExecute } from '@agentix/database';

export class PolicyStore {
  saveSnapshot(policy: OptimizedPolicy, compiledBy?: string): string {
    const snapshotId = generateId();
    const policyHash = this._hashObject(policy);
    runExecute(
      `INSERT INTO policy_snapshots (snapshot_id, policy_hash, policy_json, applied_at, compiled_by)
       VALUES (?, ?, ?, ?, ?)`,
      [snapshotId, policyHash, JSON.stringify(policy), Math.floor(Date.now() / 1000), compiledBy || null]
    );
    return snapshotId;
  }

  getLatest(): OptimizedPolicy | null {
    const row = runQuery(
      'SELECT policy_json FROM policy_snapshots ORDER BY applied_at DESC LIMIT 1'
    ) as Record<string, unknown>[];
    if (row.length === 0) return null;
    return JSON.parse(row[0].policy_json as string);
  }

  getHistory(limit: number = 20): { snapshotId: string; policyHash: string; appliedAt: number; compiledBy: string | null }[] {
    const rows = runQuery(
      'SELECT snapshot_id, policy_hash, applied_at, compiled_by FROM policy_snapshots ORDER BY applied_at DESC LIMIT ?',
      [limit]
    ) as Record<string, unknown>[];
    return rows.map((r) => ({
      snapshotId: r.snapshot_id as string,
      policyHash: r.policy_hash as string,
      appliedAt: r.applied_at as number,
      compiledBy: (r.compiled_by as string) || null,
    }));
  }

  private _hashObject(obj: unknown): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
  }
}
