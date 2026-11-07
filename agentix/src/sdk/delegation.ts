import { DelegationRoot, DelegationChainLink, TransactionResult } from './types';
import { assertAddress, assertNonZero } from './utils';
import { ContractRegistry } from './contracts';
import { TransactionManager, TxOptions } from './transaction';
import { Database } from './database';

export class DelegationModule {
  /**
   * Wires the delegation module to the contract registry, transaction sender, and local cache.
   * @returns A DelegationModule ready to use; no chain calls happen here.
   * Maps to: internal — AgentIX constructor.
   */
  constructor(
    private readonly contracts: ContractRegistry,
    private readonly tx: TransactionManager,
    private readonly db: Database,
  ) {}

  /**
   * Proposes a new delegation root for (delegator, scopeHash). This does NOT update the root: it becomes effective only after the contract's 2-day timelock AND an acceptRoot() call. Never report a propose as "root updated".
   * @param scopeHash - Non-zero bytes32 hash of the scope action; @param expiresAt - Unix seconds the new root stays valid.
   * @returns The mined transaction result for the proposal.
   * @throws ValidationError on a bad delegator address or zero scope/root.
   * Maps to: contract DelegationManager.proposeDelegationRoot; CLI 'agentix delegation' create.
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

  /**
   * Completes a pending delegation-root proposal after the 2-day timelock. Reverts before the delay (TimelockNotReady).
   * This is the step that actually changes the live delegation root.
   * @returns The mined transaction result.
   * @throws TimelockNotReady when the 2-day delay has not elapsed; revert when no proposal is pending.
   * Maps to: contract DelegationManager.acceptDelegationRoot; CLI 'agentix delegation' accept; event DelegationRootUpdated.
   */
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

  /**
   * Cancels a pending delegation-root proposal before it is accepted.
   * After cancel the live root is unchanged and a new proposal can be made.
   * @returns The mined transaction result.
   * @throws Revert when no proposal is pending.
   * Maps to: contract DelegationManager.cancelDelegationRoot; CLI 'agentix delegation' cancel.
   */
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

  /**
   * Revokes one delegation leaf for a delegator.
   * The leaf stops verifying immediately; other leaves under the same root are unaffected.
   * @param leafHash - Non-zero bytes32 hash of the delegation leaf.
   * @returns The mined transaction result.
   * @throws ValidationError on a zero leaf or bad delegator address.
   * Maps to: contract DelegationManager.revokeDelegation; event DelegationRevoked; CLI 'agentix delegation' revoke.
   */
  async revokeDelegation(leafHash: string, delegator: string, options?: TxOptions): Promise<TransactionResult> {
    assertNonZero(leafHash, 'leafHash');
    assertAddress(delegator, 'delegator');
    const dm = this.contracts.send('DelegationManager');
    return this.tx.send(
      () => dm.revokeDelegation(leafHash, delegator),
      { description: 'Revoke delegation leaf', ...options }
    );
  }

  /**
   * Reads the live delegation root (plus expiry and creation time) for a (delegator, scope) pair.
   * @returns The root record; a zero root means no root is set for this pair.
   * Maps to: contract DelegationManager.getDelegationRoot; MCP tool agentix_delegation_get_root.
   */
  async getRoot(delegator: string, scopeHash: string): Promise<DelegationRoot> {
    assertAddress(delegator, 'delegator');
    assertNonZero(scopeHash, 'scopeHash');
    const dm = this.contracts.get('DelegationManager');
    const [root, expiresAt, createdAt] = await dm.getDelegationRoot(delegator, scopeHash);
    return { root, expiresAt: Number(expiresAt), createdAt: Number(createdAt) };
  }

  /**
   * Is the leaf revoked FOR THIS DELEGATOR? Revocations are namespaced per delegator since the C-3 fix: the same leaf hash under another delegator is a different revocation. Callers must pass the delegator whose tree the leaf belongs to — a 1-arg call cannot answer this question.
   * @returns True when this delegator revoked this leaf, false otherwise.
   * Maps to: contract DelegationManager.isRevoked.
   */
  async isRevoked(delegator: string, leafHash: string): Promise<boolean> {
    assertAddress(delegator, 'delegator');
    assertNonZero(leafHash, 'leafHash');
    const dm = this.contracts.get('DelegationManager');
    return await dm.isRevoked(delegator, leafHash);
  }

  /**
   * Checks on-chain whether one delegation (leaf + Merkle proof) is valid for a delegator, scope, expiry, and depth.
   * Read-only: it answers without spending gas.
   * @param delegationLeaf - Non-zero bytes32 leaf; @param scopeHash - Non-zero bytes32 scope hash; @param maxDepth - Max delegation chain depth the proof may use.
   * @returns True when the delegation verifies, false otherwise.
   * @throws ValidationError on a bad delegator address or zero leaf/scope.
   * Maps to: contract DelegationManager.verifyDelegation; MCP tool agentix_delegation_verify.
   */
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

  /**
   * Checks on-chain whether a whole chain of delegations verifies end to end.
   * Each link must verify against the next; one bad link fails the chain. An empty chain is passed straight to the contract (which rejects it as EmptyChain).
   * @param links - Ordered chain links, each with its leaf, proof, delegator, delegate, scope, expiry, and max depth; all per-link arrays must line up by index.
   * @returns True when the full chain verifies, false otherwise.
   * Maps to: contract DelegationManager.verifyDelegationChain; MCP tool agentix_delegation_verify_chain.
   */
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
