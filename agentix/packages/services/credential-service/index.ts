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
   * Issues a credential for an agent in an organization (deprecated shim over the canonical tool).
   * WHY: backwards-compatible entry point — new callers must use src/tools/credential.ts issueCredential() directly, which owns Poseidon commitments, Merkle updates, and all 13 columns.
   * @deprecated Use src/tools/credential.ts issueCredential() instead. Removed in V2.
   * @param organizationId Organization the credential belongs to; passed through as orgId.
   * @param agentId Ignored — the canonical tool assigns the next agent id itself.
   * @param permissions Ignored — the canonical call always issues with budgetLimit "0".
   * @param expiry Unix timestamp (seconds) the credential should expire at; converted to a duration in days for the canonical call.
   * @param nullifier Ignored — the canonical tool generates its own secret/commitment.
   * @param secret Ignored — the canonical tool generates a fresh 32-byte secret.
   * @returns The issued credential row re-read from the DB.
   * @throws Throws when the canonical call fails (e.g. unknown org) or the issued row cannot be re-read.
   * Maps to: internal — src/tools/credential.ts issueCredential (canonical implementation).
   * Side effects: delegates everything to issueCredential (Poseidon/Merkle/DB writes); reads the new credential row.
   */
  async issue(organizationId: string, agentId: number, permissions: number, expiry: number, nullifier: string, secret: string): Promise<Credential> {
    // Delegate to the canonical tool implementation
    const { issueCredential } = await import("../../../src/tools/credential");
    const result = await issueCredential({
      orgId: organizationId,
      budgetLimit: "0",
      expiryDuration: (expiry - Math.floor(Date.now() / 1000)) / 86400,
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
   * Revokes an agent's credential in an organization (deprecated shim over the canonical tool).
   * WHY: backwards-compatible entry point — new callers must use src/tools/credential.ts revokeCredential() directly.
   * @deprecated Use src/tools/credential.ts revokeCredential() instead. Removed in V2.
   * @returns `{ success, nullifier, error }`; `nullifier` carries the credential's commitment (the nullifier column historically stores the commitment). On failure, success is false with an error and no nullifier.
   * @throws Never throws — canonical failures are returned as `{ success: false, error }`.
   * Maps to: internal — src/tools/credential.ts revokeCredential (canonical implementation).
   * Side effects: delegates to revokeCredential (marks the credential revoked in the DB and updates revocation state).
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

  /**
   * Fetches the credential row for one agent in one organization.
   * WHY: the read path for credential checks that need the stored commitment, budget, and expiry without re-proving anything.
   * @returns The credential, or undefined when no row matches (never an error for a missing credential).
   * @throws Throws on DB errors.
   * Maps to: internal — src/tools/credential.ts issueCredential / revokeCredential (rows they write); MCP credential reads.
   * Side effects: none (read-only).
   */
  get(organizationId: string, agentId: number): Credential | undefined {
    return runSingleCamel<Credential>(
      "SELECT * FROM credentials WHERE organization_id = ? AND agent_id = ?",
      organizationId, agentId
    );
  }

  /**
   * Fetches a credential by its credential id.
   * WHY: id-based lookup for proof flows that carry only the credential id.
   * @returns The credential, or undefined when no row matches.
   * @throws Throws on DB errors.
   * Maps to: internal — CredentialService.get (id form of the same read).
   * Side effects: none (read-only).
   */
  getById(credentialId: string): Credential | undefined {
    return runSingleCamel<Credential>("SELECT * FROM credentials WHERE credential_id = ?", credentialId);
  }

  /**
   * Lists credentials, newest first, optionally scoped to one organization.
   * WHY: the operator's credential inventory — what an org has issued and what is still active.
   * @param organizationId When given, only that org's credentials; when omitted, all credentials.
   * @returns Credentials ordered by created_at descending; empty array when none exist. Includes revoked rows — callers must filter on the revoked flag themselves.
   * @throws Throws on DB errors.
   * Maps to: internal — CredentialService.getHistory (same query, org-scoped).
   * Side effects: none (read-only).
   */
  list(organizationId?: string): Credential[] {
    if (organizationId) {
      return runQueryCamel<Credential>("SELECT * FROM credentials WHERE organization_id = ? ORDER BY created_at DESC", organizationId);
    }
    return runQueryCamel<Credential>("SELECT * FROM credentials ORDER BY created_at DESC");
  }

  /**
   * Counts credentials, optionally scoped to one organization.
   * WHY: the cheap cardinality check for dashboards and guards that only need a number, not rows.
   * @returns The row count, 0 when none; counts revoked credentials too.
   * @throws Throws on DB errors.
   * Maps to: internal — CredentialService.list (count form of the same query).
   * Side effects: none (read-only).
   */
  count(organizationId?: string): number {
    if (organizationId) {
      const r = runSingleCamel<{ count: number }>("SELECT COUNT(*) as count FROM credentials WHERE organization_id = ?", organizationId);
      return r?.count || 0;
    }
    const r = runSingleCamel<{ count: number }>("SELECT COUNT(*) as count FROM credentials");
    return r?.count || 0;
  }

  /**
   * Lists an organization's credentials newest first (same query as the org-scoped list()).
   * WHY: the per-org audit trail — every credential the org ever issued, in reverse chronological order.
   * @returns Credentials ordered by created_at descending; empty array for an unknown org or one with no credentials. Includes revoked rows.
   * @throws Throws on DB errors.
   * Maps to: internal — CredentialService.list (duplicate of the org-scoped branch; kept for the MCP/tests history read).
   * Side effects: none (read-only).
   */
  getHistory(organizationId: string): Credential[] {
    return runQueryCamel<Credential>(
      "SELECT * FROM credentials WHERE organization_id = ? ORDER BY created_at DESC",
      organizationId
    );
  }
}

let _svc: CredentialService | null = null;
/**
 * Returns the process-wide singleton CredentialService.
 * WHY: one service per process — all credential reads share the same event-bus subscription surface.
 * @returns The singleton instance.
 * @throws Never throws.
 * Maps to: internal — CredentialService (module-level accessor).
 * Side effects: creates the singleton on first call.
 */
export function getCredentialService(): CredentialService {
  if (!_svc) _svc = new CredentialService();
  return _svc;
}
