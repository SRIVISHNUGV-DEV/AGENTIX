import { TransactionResult } from './types';
import { assertAddress, assertNonZero } from './utils';
import { ContractRegistry } from './contracts';
import { TransactionManager, TxOptions } from './transaction';
import { Database } from './database';

export class CapabilityModule {
  /**
   * Wires the capability module to the contract registry, transaction sender, and local cache.
   * @returns A CapabilityModule ready to use; no chain calls happen here.
   * Maps to: internal — AgentIX constructor.
   */
  constructor(
    private readonly contracts: ContractRegistry,
    private readonly tx: TransactionManager,
    private readonly db: Database,
  ) {}

  /**
   * Revokes a registered capability permanently.
   * Grants issued under a revoked capability no longer verify.
   * @param capabilityId - Non-zero bytes32 capability id.
   * @returns The mined transaction result.
   * @throws ValidationError on a zero id; contract errors when the caller is not authorized.
   * Maps to: contract CapabilityRegistry.revokeCapability; event CapabilityRevoked; CLI 'agentix capability' revoke.
   */
  async revoke(capabilityId: string, options?: TxOptions): Promise<TransactionResult> {
    assertNonZero(capabilityId, 'capabilityId');
    const cap = this.contracts.send('CapabilityRegistry');
    return this.tx.send(
      () => cap.revokeCapability(capabilityId),
      { description: 'Revoke capability ' + capabilityId, ...options }
    );
  }

  /**
   * Reads a capability's stored record (action hash, registrar, creation/expiry, revoked flag).
   * @returns The capability record; fields are zeroed when the id was never registered.
   * Maps to: contract CapabilityRegistry.capabilities; MCP tool agentix_capability_get.
   */
  async get(capabilityId: string) {
    const cap = this.contracts.get('CapabilityRegistry');
    const c = await cap.capabilities(capabilityId);
    return {
      capabilityId,
      actionHash: c.actionHash,
      registrar: c.registrar,
      createdAt: Number(c.createdAt),
      expiresAt: Number(c.expiresAt),
      revoked: c.revoked,
    };
  }

  /**
   * Replaces the Merkle root of grants for one (grantee, capability) pair.
   * The new root is the new source of truth for which grant leaves verify — old grants under the replaced root stop verifying.
   * @param grantee - Address whose grants change; @param newRoot - Non-zero bytes32 root.
   * @returns The mined transaction result.
   * @throws ValidationError on a bad grantee address or zero id/root.
   * Maps to: contract CapabilityRegistry.updateGrantRoot; event GrantRootUpdated.
   */
  async updateGrantRoot(
    grantee: string, capabilityId: string, newRoot: string,
    options?: TxOptions
  ): Promise<TransactionResult> {
    assertAddress(grantee, 'grantee');
    assertNonZero(capabilityId, 'capabilityId');
    assertNonZero(newRoot, 'newRoot');
    const cap = this.contracts.send('CapabilityRegistry');
    return this.tx.send(
      () => cap.updateGrantRoot(grantee, capabilityId, newRoot),
      { description: 'Update grant root for ' + grantee, ...options }
    );
  }

  /**
   * Revokes one specific grant leaf for a (grantor, grantee, capability) triple.
   * Only the named grant is affected; other grants under the same root keep verifying.
   * @param grantLeafHash - Non-zero bytes32 hash of the grant leaf; @param grantor - Address that issued the grant.
   * @returns The mined transaction result.
   * @throws ValidationError on bad addresses or zero hashes; GrantNotRevocable when the caller may not revoke it.
   * Maps to: contract CapabilityRegistry.revokeGrant; event GrantRevoked.
   */
  async revokeGrant(
    grantLeafHash: string, capabilityId: string,
    grantor: string, grantee: string,
    options?: TxOptions
  ): Promise<TransactionResult> {
    assertNonZero(grantLeafHash, 'grantLeafHash');
    assertNonZero(capabilityId, 'capabilityId');
    assertAddress(grantor, 'grantor');
    assertAddress(grantee, 'grantee');
    const cap = this.contracts.send('CapabilityRegistry');
    return this.tx.send(
      () => cap.revokeGrant(grantLeafHash, capabilityId, grantor, grantee),
      { description: 'Revoke grant', ...options }
    );
  }

  /**
   * Checks on-chain whether an agent holds a valid grant for a capability (Merkle proof + constraints + expiry).
   * Read-only: it answers the question without spending gas or changing state.
   * @param agent - Address claiming the capability; @param grantLeaf - Non-zero bytes32 leaf being proven; @param expiresAt - Unix seconds the grant must still cover.
   * @returns True when the grant verifies, false otherwise (including expired or revoked grants).
   * @throws ValidationError on bad addresses or zero id/leaf.
   * Maps to: contract CapabilityRegistry.verifyCapability; MCP tool agentix_capability_verify.
   */
  async verify(
    agent: string, capabilityId: string,
    grantLeaf: string, merkleProof: string[],
    grantor: string, constraintsHash: string,
    expiresAt: number
  ): Promise<boolean> {
    assertAddress(agent, 'agent');
    assertAddress(grantor, 'grantor');
    assertNonZero(capabilityId, 'capabilityId');
    assertNonZero(grantLeaf, 'grantLeaf');

    const cap = this.contracts.get('CapabilityRegistry');
    return await cap.verifyCapability(
      agent, capabilityId, grantLeaf, merkleProof, grantor, constraintsHash, expiresAt
    );
  }
}
