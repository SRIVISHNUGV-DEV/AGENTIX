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

  async updateRoot(
    delegator: string, scopeHash: string, newRoot: string, expiresAt: number,
    options?: TxOptions
  ): Promise<TransactionResult> {
    assertAddress(delegator, 'delegator');
    assertNonZero(scopeHash, 'scopeHash');
    assertNonZero(newRoot, 'newRoot');
    const dm = this.contracts.send('DelegationManager');
    return this.tx.send(
      () => dm.updateDelegationRoot(delegator, scopeHash, newRoot, expiresAt),
      { description: 'Update delegation root for ' + delegator, ...options }
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

  async isRevoked(leafHash: string): Promise<boolean> {
    const dm = this.contracts.get('DelegationManager');
    return await dm.isRevoked(leafHash);
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
