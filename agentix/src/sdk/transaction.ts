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
  /**
   * Wires the transaction sender to the contract registry and the local event/pending-tx store.
   * @returns A TransactionManager ready to send; no chain calls happen here.
   * Maps to: internal — AgentIX constructor.
   */
  constructor(
    private readonly contracts: ContractRegistry,
    private readonly db: Database,
  ) {}

  /**
   * Sends one contract transaction, waits for it to mine, and records the receipt and events locally.
   * The single choke point for all SDK writes: retry, error mapping, and local persistence all happen here.
   * @param method - A closure that submits the transaction; called again on retry, so it must be safe to re-invoke.
   * @param options - retries (default 1) counts re-submissions after the first attempt; description labels the pending-tx record.
   * @returns The tx hash, the receipt (null only if the node returns none), and the parsed events.
   * @throws The mapped contract error (see mapContractError); an 'already known' error is retried instead of thrown.
   * Maps to: contract — every SDK write (SessionManager, AgentWallet, CredentialRegistry, and the rest).
   * Side effects: writes a pending-tx row and the mined events to the local DB; re-submits on retry, so a method whose first attempt actually mined but whose wait failed can send a duplicate transaction.
   */
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

  /**
   * Returns the gas limit of the transaction the given method submits.
   * WARNING: despite the name this SUBMITS a real on-chain transaction and returns its gasLimit — it does not dry-run or call estimateGas. Do not call it for a read-only estimate; there is currently no caller in the codebase.
   * @returns The submitted transaction's gasLimit.
   * @throws The mapped contract error if submission fails.
   * Maps to: internal — no current caller (latent hazard, see report).
   * Side effects: sends an on-chain transaction and spends gas.
   */
  async estimate(method: () => Promise<ContractTransactionResponse>): Promise<bigint> {
    try {
      const tx = await method();
      return tx.gasLimit;
    } catch (err) {
      throw mapContractError(err);
    }
  }

  /**
   * Runs a closure and rethrows any failure as the mapped contract error.
   * A thin wrapper so read/call paths get the same typed errors as writes without duplicating the mapping.
   * @returns Whatever the closure returns, unchanged.
   * @throws The mapped contract error (see mapContractError).
   * Maps to: internal — no current caller.
   */
  async simulate<T>(method: () => Promise<T>): Promise<T> {
    try {
      return await method();
    } catch (err) {
      throw mapContractError(err);
    }
  }

  /**
   * Waits for an already-submitted transaction to mine and records its events locally.
   * Use when the submit and the wait happen in different places (e.g. a tx submitted elsewhere needs its events indexed).
   * @param hash - Transaction hash to wait for; @param timeoutMs - how long to wait for 1 confirmation (default 60s).
   * @returns The parsed events; an empty array when the receipt never arrives within the timeout.
   * @throws When the provider errors or the timeout elapses (provider waitForTransaction throws on timeout).
   * Maps to: internal — callers that submitted outside TransactionManager.send.
   * Side effects: writes the mined events and the confirmed/failed status to the local DB.
   */
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

  /**
   * Turns raw receipt logs into IndexedEvents with the raw topic hash as the event name.
   * NOTE: eventName here is the topic-0 signature hash, NOT the decoded event name — callers must match against a computed topic hash (see WalletModule.create), never against a name like 'WalletCreated'.
   * @param receipt - The mined receipt (null-safe); @returns An empty array when there is no receipt or no logs.
   * Maps to: internal — TransactionManager.send and wait.
   */
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
