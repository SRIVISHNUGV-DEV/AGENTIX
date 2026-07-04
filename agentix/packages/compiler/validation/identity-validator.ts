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

export function checkIdentityActive(identityId: number): { valid: boolean; error?: string } {
  const result = checkIdentityExists(identityId);
  if (!result.valid) return result;
  if (!result.identity?.active) {
    return { valid: false, error: `Identity ${identityId} is inactive` };
  }
  return { valid: true };
}

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
