import { CompilationCacheEntry } from '../types/compilation';
import { runQuery, runSingle, runExecute } from '@agentix/database';

export class CompilationCacheStore {
  get(contentHash: string): CompilationCacheEntry | null {
    const row = runSingle(
      'SELECT content_hash, intent_json, plan_json, created_at, ttl FROM compilation_cache WHERE content_hash = ?',
      [contentHash]
    ) as Record<string, unknown> | undefined;
    if (!row) return null;

    const createdAt = row.created_at as number;
    const ttl = row.ttl as number;
    const now = Math.floor(Date.now() / 1000);
    if (createdAt + ttl < now) {
      this.invalidate(contentHash);
      return null;
    }

    return {
      contentHash: row.content_hash as string,
      intentJson: row.intent_json as string,
      planJson: row.plan_json as string,
      createdAt,
      ttl,
    };
  }

  set(contentHash: string, intentJson: string, planJson: string, ttl: number): void {
    runExecute(
      `INSERT OR REPLACE INTO compilation_cache (content_hash, intent_json, plan_json, created_at, ttl)
       VALUES (?, ?, ?, ?, ?)`,
      [contentHash, intentJson, planJson, Math.floor(Date.now() / 1000), ttl]
    );
  }

  invalidate(contentHash: string): void {
    runExecute('DELETE FROM compilation_cache WHERE content_hash = ?', [contentHash]);
  }

  prune(): number {
    const now = Math.floor(Date.now() / 1000);
    const result = runExecute(
      'DELETE FROM compilation_cache WHERE created_at + ttl < ?',
      [now]
    );
    return typeof result === 'number' ? result : 0;
  }

  clear(): void {
    runExecute('DELETE FROM compilation_cache');
  }
}
