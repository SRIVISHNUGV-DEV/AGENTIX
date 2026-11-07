import { runSingle } from '@agentix/database';

export interface IdentityCheckResult {
  valid: boolean;
  error?: string;
  identity?: {
    identityId: number;
    wallet: string;
    credentialId: number;
    active: boolean;
    createdAt: number;
  };
}

/**
 * Look up an agent identity by id in the local identities table.
 * Why: stage-2 validation needs existence + the identity record (wallet, credential, active flag) in one query.
 * @param identityId - numeric identity id.
 * @returns { valid, error, identity }: valid false with "not found" when absent; otherwise valid true with the identity record.
 * @throws Propagates DB errors — callers in stage 2 do not catch them, so a DB outage fails validation loudly.
 * Side effects: reads the identities table.
 * Maps to: contract AgentIdentity (identity registry).
 */
export function checkIdentityExists(identityId: number): IdentityCheckResult {
  const row = runSingle(
    'SELECT identity_id, wallet_address, credential_id, active, created_at FROM identities WHERE identity_id = ?',
    [identityId]
  ) as Record<string, unknown> | undefined;

  if (!row) {
    return { valid: false, error: `Identity ${identityId} not found` };
  }

  return {
    valid: true,
    identity: {
      identityId: row.identity_id as number,
      wallet: row.wallet_address as string,
      credentialId: row.credential_id as number,
      active: Boolean(row.active),
      createdAt: row.created_at as number,
    },
  };
}

/**
 * Check an identity exists and is active.
 * Why: existence is not enough — a deactivated identity must not pass validation even though its row is still there.
 * @param identityId - numeric identity id.
 * @returns { valid, error }: valid false when missing or inactive, with the corresponding message.
 * Maps to: contract AgentIdentity (deactivate/reactivate).
 */
export function checkIdentityActive(identityId: number): { valid: boolean; error?: string } {
  const result = checkIdentityExists(identityId);
  if (!result.valid) return result;
  if (!result.identity?.active) {
    return { valid: false, error: `Identity ${identityId} is inactive` };
  }
  return { valid: true };
}

/**
 * Check a wallet address has a row in the local wallets table.
 * Why: stage 2 treats an unknown wallet as a warning (not an error) — this is the lookup behind that decision.
 * @param walletAddress - wallet address (exact match, case-sensitive as stored).
 * @returns { valid, error }: valid false with "not found" when absent.
 * Side effects: reads the wallets table.
 * Maps to: contract AgentWalletFactory (wallet deployment registry).
 */
export function checkWalletExists(walletAddress: string): { valid: boolean; error?: string } {
  const row = runSingle(
    'SELECT wallet_address FROM wallets WHERE wallet_address = ?',
    [walletAddress]
  ) as Record<string, unknown> | undefined;

  if (!row) {
    return { valid: false, error: `Wallet ${walletAddress} not found` };
  }
  return { valid: true };
}

/**
 * Look up an organization by id and report whether it is active.
 * Why: stage 2 needs both facts at once — a missing org is an error, an inactive org is a different error, and one query answers both.
 * @param organizationId - organization id string.
 * @returns { valid, error, active }: valid false with "not found" when absent; otherwise valid true with active as stored.
 * Side effects: reads the organizations table.
 * Maps to: contract OrganizationRegistry.
 */
export function checkOrganizationExists(organizationId: string): { valid: boolean; error?: string; active?: boolean } {
  const row = runSingle(
    'SELECT id, active FROM organizations WHERE id = ?',
    [organizationId]
  ) as Record<string, unknown> | undefined;

  if (!row) {
    return { valid: false, error: `Organization ${organizationId} not found` };
  }

  return {
    valid: true,
    active: Boolean(row.active),
  };
}

/**
 * Check a session exists, is not revoked, and has not expired.
 * Why: executing against a revoked or expired session would bypass the session's spend/expiry bounds — this is the check that stops it at validation time.
 * @param sessionId - session id string.
 * @returns { valid, error }: valid false when missing, revoked, or expired (expiry compared against current unix seconds).
 * Side effects: reads the sessions table.
 * Security note: this is a local-DB view of session state — on-chain revocation is authoritative at execution; a stale local row is a real (if narrow) window.
 * Maps to: contract SessionManager.revokeSession.
 */
export function checkSessionValid(sessionId: string): { valid: boolean; error?: string } {
  const row = runSingle(
    'SELECT session_id, revoked, expiry FROM sessions WHERE session_id = ?',
    [sessionId]
  ) as Record<string, unknown> | undefined;

  if (!row) {
    return { valid: false, error: `Session ${sessionId} not found` };
  }

  if (row.revoked) {
    return { valid: false, error: `Session ${sessionId} is revoked` };
  }

  const expiry = row.expiry as number;
  if (expiry && expiry < Math.floor(Date.now() / 1000)) {
    return { valid: false, error: `Session ${sessionId} has expired` };
  }

  return { valid: true };
}
