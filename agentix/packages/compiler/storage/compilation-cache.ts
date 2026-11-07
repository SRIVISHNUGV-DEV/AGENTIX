import { CompilationCacheEntry } from '../types/compilation';
import { runQuery, runSingle, runExecute } from '@agentix/database';

export class CompilationCacheStore {
  /**
   * Fetch a cached compilation by content hash, honouring TTL.
   * Why: the cache is the compile fast path — a hit skips all 10 stages.
   * @param contentHash - checksum of action+params+context+addresses.
   * @returns The cache entry, or null when missing or expired (expired rows are deleted on read).
   * Side effects: deletes expired rows it encounters; reads the compilation_cache table.
   * Maps to: internal — PipelineOrchestrator.compile (cache check).
   */
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

  /**
   * Store (or replace) a compilation in the cache.
   * Why: INSERT OR REPLACE makes re-compiles of the same content refresh the entry instead of duplicating it.
   * @param contentHash - cache key.
   * @param intentJson - serialized parsed intent.
   * @param planJson - serialized execution plan.
   * @param ttl - seconds the entry stays valid (from config.cacheTtl, default 300).
   * Side effects: writes one row to compilation_cache.
   * Maps to: internal — PipelineOrchestrator.compile (cache write).
   */
  set(contentHash: string, intentJson: string, planJson: string, ttl: number): void {
    runExecute(
      `INSERT OR REPLACE INTO compilation_cache (content_hash, intent_json, plan_json, created_at, ttl)
       VALUES (?, ?, ?, ?, ?)`,
      [contentHash, intentJson, planJson, Math.floor(Date.now() / 1000), ttl]
    );
  }

  /**
   * Delete one cache entry by hash.
   * Why: targeted eviction when a cached plan is known stale — e.g. a corrupt cached plan that failed to parse.
   * @param contentHash - cache key; unknown hashes are a no-op.
   * Side effects: deletes one row from compilation_cache.
   * Maps to: internal — PipelineOrchestrator.compile (corrupt-cache path) / CompilationCacheStore.get.
   */
  invalidate(contentHash: string): void {
    runExecute('DELETE FROM compilation_cache WHERE content_hash = ?', [contentHash]);
  }

  /**
   * Delete all expired cache rows.
   * Why: bounds the cache table without touching live entries.
   * @returns Number of rows deleted (0 when nothing expired, or when the driver does not report a count).
   * Side effects: deletes expired rows from compilation_cache.
   * Maps to: internal — PipelineOrchestrator.pruneCache.
   */
  prune(): number {
    const now = Math.floor(Date.now() / 1000);
    const result = runExecute(
      'DELETE FROM compilation_cache WHERE created_at + ttl < ?',
      [now]
    );
    return typeof result === 'number' ? result : 0;
  }

  /**
   * Delete every cache row.
   * Why: the nuclear option for stale caches after config or contract changes.
   * Side effects: wipes the whole compilation_cache table; execution_plans untouched.
   * Maps to: internal — PipelineOrchestrator.clearCache.
   */
  clear(): void {
    runExecute('DELETE FROM compilation_cache');
  }
}
