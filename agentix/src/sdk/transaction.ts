import { ContractTransactionResponse } from 'ethers';
import { TransactionResult, IndexedEvent } from './types';
import { mapContractError } from './errors';
import { ContractRegistry } from './contracts';
import { Database } from './database';

export interface TxOptions {
  description?: string;
  retries?: number;
}

export class TransactionManager {
  constructor(
    private readonly contracts: ContractRegistry,
    private readonly db: Database,
  ) {}

  async send(
    method: () => Promise<ContractTransactionResponse>,
    options: TxOptions = {}
  ): Promise<TransactionResult> {
    const { description = 'Contract call', retries = 1 } = options;

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
        }

        const tx = await method();
        this.db.savePendingTx({ hash: tx.hash, description, status: 'pending' });

        const receipt = await tx.wait();
        const events = this._parseEvents(receipt, tx.hash);

        this.db.saveEvents(events);
        this.db.updatePendingTx(tx.hash, receipt?.status === 1 ? 'confirmed' : 'failed');

        return { hash: tx.hash, receipt, events };
      } catch (err: unknown) {
        lastError = mapContractError(err);
        if (err instanceof Error && err.message.includes('already known')) continue;
        throw lastError;
      }
    }
    throw lastError;
  }

  async estimate(method: () => Promise<ContractTransactionResponse>): Promise<bigint> {
    try {
      const tx = await method();
      return tx.gasLimit;
    } catch (err) {
      throw mapContractError(err);
    }
  }

  async simulate<T>(method: () => Promise<T>): Promise<T> {
    try {
      return await method();
    } catch (err) {
      throw mapContractError(err);
    }
  }

  async wait(hash: string, timeoutMs = 60000): Promise<IndexedEvent[]> {
    const receipt: any = await this.contracts.provider.waitForTransaction(hash, 1, timeoutMs);
    if (receipt) {
      const events = this._parseEvents(receipt, hash);
      this.db.saveEvents(events);
      this.db.updatePendingTx(hash, receipt.status === 1 ? 'confirmed' : 'failed');
      return events;
    }
    return [];
  }

  private _parseEvents(receipt: any, txHash: string): IndexedEvent[] {
    if (!receipt) return [];
    return (receipt.logs || []).map((log: any, i: number) => ({
      id: txHash + '-' + i,
      blockNumber: receipt.blockNumber,
      transactionHash: txHash,
      logIndex: log.index,
      eventName: log.topics?.[0] || 'unknown',
      contractAddress: log.address,
      args: { topics: log.topics, data: log.data },
    }));
  }
}
