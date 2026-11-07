import { OptimizedPolicy } from '../types/policy';
import { generateId } from '@agentix/utils';
import { runQuery, runExecute } from '@agentix/database';

export class PolicyStore {
  /**
   * Persist a policy snapshot and return its id.
   * Why: policy history is the audit trail — when a plan's limits are questioned later, the snapshot shows exactly which policy produced them.
   * @param policy - optimized policy to snapshot.
   * @param compiledBy - optional wallet address, stored for audit; null when omitted.
   * @returns The generated snapshot id.
   * Side effects: one INSERT into policy_snapshots with a sha256 hash of the policy JSON.
   * Maps to: policy rule spend-cap (snapshot of the effective limits).
   */
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

  /**
   * Fetch the most recently applied policy snapshot.
   * Why: "what policy is live right now" is the starting question for any policy investigation.
   * @returns The latest policy, or null when no snapshot exists.
   * Maps to: internal — PolicyStore.saveSnapshot.
   */
  getLatest(): OptimizedPolicy | null {
    const row = runQuery(
      'SELECT policy_json FROM policy_snapshots ORDER BY applied_at DESC LIMIT 1'
    ) as Record<string, unknown>[];
    if (row.length === 0) return null;
    return JSON.parse(row[0].policy_json as string);
  }

  /**
   * List policy snapshot metadata (no bodies), newest first.
   * Why: history views need ids/hashes/timestamps without loading every full policy JSON.
   * @param limit - max rows; defaults to 20.
   * @returns Snapshot metadata newest first; empty array when no snapshots exist.
   * Maps to: internal — PolicyStore.saveSnapshot.
   */
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

  /**
   * SHA-256 hash the JSON serialization of an object.
   * Why: the snapshot hash is the integrity/dedup identity — identical policies hash identically.
   * @param obj - any JSON-serializable value.
   * @returns Lowercase hex digest.
   * Maps to: internal — PolicyStore.saveSnapshot.
   */
  private _hashObject(obj: unknown): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
  }
}
