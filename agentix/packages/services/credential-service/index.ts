import { runExecute, runSingleCamel, runQueryCamel } from "../../core/database";
import { getEventBus } from "../../core/eventbus";
import type { Credential } from "../../shared/types";

/**
 * CredentialService — Thin read-only wrapper around the database.
 *
 * WRITE operations (issue, revoke) are delegated to src/tools/credential.ts
 * which is the CANONICAL implementation. It handles:
 * - Poseidon commitment computation
 * - Merkle tree updates
 * - Event persistence
 * - All 13 columns (including wallet_address, budget_limit, credential_version, commitment)
 *
 * This service only provides read operations for the MCP server and tests.
 */
export class CredentialService {
  private bus = getEventBus();

  /**
   * @deprecated Use src/tools/credential.ts issueCredential() instead.
   * This method exists only for backwards compatibility and will be removed in V2.
   */
  async issue(organizationId: string, agentId: number, permissions: number, expiry: number, nullifier: string, secret: string): Promise<Credential> {
    // Delegate to the canonical tool implementation
    const { issueCredential } = await import("../../../src/tools/credential");
    const result = await issueCredential({
      orgId: organizationId,
      budgetLimit: "0",
      expiryDuration: expiry - Math.floor(Date.now() / 1000),
      expiryUnit: "days",
      walletAddress: "",
      ownerAddress: "",
    });

    if (!result.success) {
      throw new Error(result.error || "Failed to issue credential");
    }

    // Return in the old format for backwards compatibility
    return runSingleCamel<Credential>(
      "SELECT * FROM credentials WHERE credential_id = ?",
      result.credentialId
    )!;
  }

  /**
   * @deprecated Use src/tools/credential.ts revokeCredential() instead.
   * This method exists only for backwards compatibility and will be removed in V2.
   */
  async revoke(organizationId: string, agentId: number): Promise<{ success: boolean; nullifier?: string; error?: string }> {
    // Delegate to the canonical tool implementation
    const { revokeCredential } = await import("../../../src/tools/credential");
    const result = await revokeCredential(organizationId, agentId);

    return {
      success: result.success,
      nullifier: result.commitment,
      error: result.error,
    };
  }

  get(organizationId: string, agentId: number): Credential | undefined {
    return runSingleCamel<Credential>(
      "SELECT * FROM credentials WHERE organization_id = ? AND agent_id = ?",
      organizationId, agentId
    );
  }

  getById(credentialId: string): Credential | undefined {
    return runSingleCamel<Credential>("SELECT * FROM credentials WHERE credential_id = ?", credentialId);
  }

  list(organizationId?: string): Credential[] {
    if (organizationId) {
      return runQueryCamel<Credential>("SELECT * FROM credentials WHERE organization_id = ? ORDER BY created_at DESC", organizationId);
    }
    return runQueryCamel<Credential>("SELECT * FROM credentials ORDER BY created_at DESC");
  }

  count(organizationId?: string): number {
    if (organizationId) {
      const r = runSingleCamel<{ count: number }>("SELECT COUNT(*) as count FROM credentials WHERE organization_id = ?", organizationId);
      return r?.count || 0;
    }
    const r = runSingleCamel<{ count: number }>("SELECT COUNT(*) as count FROM credentials");
    return r?.count || 0;
  }

  getHistory(organizationId: string): Credential[] {
    return runQueryCamel<Credential>(
      "SELECT * FROM credentials WHERE organization_id = ? ORDER BY created_at DESC",
      organizationId
    );
  }
}

let _svc: CredentialService | null = null;
export function getCredentialService(): CredentialService {
  if (!_svc) _svc = new CredentialService();
  return _svc;
}
