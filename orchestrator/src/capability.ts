import { TransactionResult } from './types.js';
import { assertAddress, assertNonZero } from './utils.js';
import { ContractRegistry } from './contracts.js';
import { TransactionManager, TxOptions } from './transaction.js';
import { Database } from './database.js';

export class CapabilityModule {
  constructor(
    private readonly contracts: ContractRegistry,
    private readonly tx: TransactionManager,
    private readonly db: Database,
  ) {}

  async revoke(capabilityId: string, options?: TxOptions): Promise<TransactionResult> {
    assertNonZero(capabilityId, 'capabilityId');
    const cap = this.contracts.send('CapabilityRegistry');
    return this.tx.send(
      () => cap.revokeCapability(capabilityId),
      { description: 'Revoke capability ' + capabilityId, ...options }
    );
  }

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
