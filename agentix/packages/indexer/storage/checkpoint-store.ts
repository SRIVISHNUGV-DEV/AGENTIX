import { Checkpoint } from '../types';
import { runQuery, runSingle, runExecute } from '@agentix/database';

export class CheckpointStore {
  get(contractName: string): Checkpoint | null {
    const row = runSingle(
      'SELECT contract_name, last_block, processed_at FROM indexer_checkpoints WHERE contract_name = ?',
      [contractName]
    ) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      contractName: row.contract_name as string,
      lastBlock: row.last_block as number,
      processedAt: row.processed_at as number,
    };
  }

  set(contractName: string, lastBlock: number): void {
    runExecute(
      `INSERT INTO indexer_checkpoints (contract_name, last_block, processed_at)
       VALUES (?, ?, ?)
       ON CONFLICT(contract_name) DO UPDATE SET last_block = excluded.last_block, processed_at = excluded.processed_at`,
      [contractName, lastBlock, Math.floor(Date.now() / 1000)]
    );
  }

  getAll(): Checkpoint[] {
    const rows = runQuery(
      'SELECT contract_name, last_block, processed_at FROM indexer_checkpoints'
    ) as Record<string, unknown>[];
    return rows.map((r) => ({
      contractName: r.contract_name as string,
      lastBlock: r.last_block as number,
      processedAt: r.processed_at as number,
    }));
  }

  delete(contractName: string): void {
    runExecute('DELETE FROM indexer_checkpoints WHERE contract_name = ?', [contractName]);
  }

  clear(): void {
    runExecute('DELETE FROM indexer_checkpoints');
  }
}
