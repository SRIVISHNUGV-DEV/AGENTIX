import { DelegationRoot, DelegationChainLink, TransactionResult } from './types';
import { assertAddress, assertNonZero } from './utils';
import { ContractRegistry } from './contracts';
import { TransactionManager, TxOptions } from './transaction';
import { Database } from './database';

export class DelegationModule {
  constructor(
    private readonly contracts: ContractRegistry,
    private readonly tx: TransactionManager,
    private readonly db: Database,
  ) {}

  /**
   * Propose a new delegation root for (delegator, scopeHash). This does NOT
   * update the root: it becomes effective only after the contract's 2-day
   * timelock AND an acceptRoot() call. Never report a propose as "root updated".
   */
  async proposeRoot(
    delegator: string, scopeHash: string, newRoot: string, expiresAt: number,
    options?: TxOptions
  ): Promise<TransactionResult> {
    assertAddress(delegator, 'delegator');
    assertNonZero(scopeHash, 'scopeHash');
    assertNonZero(newRoot, 'newRoot');
    const dm = this.contracts.send('DelegationManager');
    return this.tx.send(
      () => dm.proposeDelegationRoot(delegator, scopeHash, newRoot, expiresAt),
      { description: 'Propose delegation root for ' + delegator + ' (effective after 2-day timelock + accept)', ...options }
    );
  }

  /** Complete a pending delegation-root proposal after the 2-day timelock. Reverts before the delay (TimelockNotReady). */
  async acceptRoot(
    delegator: string, scopeHash: string,
    options?: TxOptions
  ): Promise<TransactionResult> {
    assertAddress(delegator, 'delegator');
    assertNonZero(scopeHash, 'scopeHash');
    const dm = this.contracts.send('DelegationManager');
    return this.tx.send(
      () => dm.acceptDelegationRoot(delegator, scopeHash),
      { description: 'Accept pending delegation root for ' + delegator, ...options }
    );
  }

  /** Cancel a pending delegation-root proposal. */
  async cancelRoot(
    delegator: string, scopeHash: string,
    options?: TxOptions
  ): Promise<TransactionResult> {
    assertAddress(delegator, 'delegator');
    assertNonZero(scopeHash, 'scopeHash');
    const dm = this.contracts.send('DelegationManager');
    return this.tx.send(
      () => dm.cancelDelegationRoot(delegator, scopeHash),
      { description: 'Cancel pending delegation root for ' + delegator, ...options }
    );
  }

  async revokeDelegation(leafHash: string, delegator: string, options?: TxOptions): Promise<TransactionResult> {
    assertNonZero(leafHash, 'leafHash');
    assertAddress(delegator, 'delegator');
    const dm = this.contracts.send('DelegationManager');
    return this.tx.send(
      () => dm.revokeDelegation(leafHash, delegator),
      { description: 'Revoke delegation leaf', ...options }
    );
  }

  async getRoot(delegator: string, scopeHash: string): Promise<DelegationRoot> {
    assertAddress(delegator, 'delegator');
    assertNonZero(scopeHash, 'scopeHash');
    const dm = this.contracts.get('DelegationManager');
    const [root, expiresAt, createdAt] = await dm.getDelegationRoot(delegator, scopeHash);
    return { root, expiresAt: Number(expiresAt), createdAt: Number(createdAt) };
  }

  /**
   * Is the leaf revoked FOR THIS DELEGATOR? Revocations are namespaced per
   * delegator since the C-3 fix: the same leaf hash under another delegator
   * is a different revocation. Callers must pass the delegator whose tree
   * the leaf belongs to — a 1-arg call cannot answer this question.
   */
  async isRevoked(delegator: string, leafHash: string): Promise<boolean> {
    assertAddress(delegator, 'delegator');
    assertNonZero(leafHash, 'leafHash');
    const dm = this.contracts.get('DelegationManager');
    return await dm.isRevoked(delegator, leafHash);
  }

  async verify(
    delegationLeaf: string, merkleProof: string[],
    delegator: string, scopeHash: string, expiresAt: number, maxDepth: number
  ): Promise<boolean> {
    assertNonZero(delegationLeaf, 'delegationLeaf');
    assertAddress(delegator, 'delegator');
    assertNonZero(scopeHash, 'scopeHash');
    const dm = this.contracts.get('DelegationManager');
    return await dm.verifyDelegation(delegationLeaf, merkleProof, delegator, scopeHash, expiresAt, maxDepth);
  }

  async verifyChain(links: DelegationChainLink[]): Promise<boolean> {
    const dm = this.contracts.get('DelegationManager');
    return await dm.verifyDelegationChain(
      links.map(l => l.delegationLeaf),
      links.map(l => l.merkleProof),
      links.map(l => l.delegator),
      links.map(l => l.delegate),
      links.map(l => l.scopeHash),
      links.map(l => l.expiresAt),
      links.map(l => l.maxDepth),
    );
  }

}
