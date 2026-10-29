import { z } from 'zod';
import { KNOWN_ACTIONS } from '../types/intent';

export const WalletCreateSchema = z.object({
  action: z.literal('wallet_create'),
  params: z.object({
    ownerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    salt: z.string().optional(),
  }),
});

export const WalletExecuteSchema = z.object({
  action: z.literal('wallet_execute'),
  params: z.object({
    walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    target: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    value: z.string().regex(/^\d+$/),
    data: z.string().regex(/^0x[a-fA-F0-9]*$/),
    sessionId: z.string().optional(),
  }),
});

export const WalletExecuteBatchSchema = z.object({
  action: z.literal('wallet_execute_batch'),
  params: z.object({
    walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    targets: z.array(z.string().regex(/^0x[a-fA-F0-9]{40}$/)).min(1).max(20),
    values: z.array(z.string().regex(/^\d+$/)).min(1).max(20),
    data: z.array(z.string().regex(/^0x[a-fA-F0-9]*$/)).min(1).max(20),
  }),
});

export const WalletDepositSchema = z.object({
  action: z.literal('wallet_deposit'),
  params: z.object({
    walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    amount: z.string().regex(/^\d+$/),
  }),
});

export const WalletWithdrawSchema = z.object({
  action: z.literal('wallet_withdraw'),
  params: z.object({
    walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    amount: z.string().regex(/^\d+$/),
  }),
});

export const SessionCreateSchema = z.object({
  action: z.literal('session_create'),
  params: z.object({
    walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    sessionKey: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    maxValue: z.string().regex(/^\d+$/).optional(),
    expiry: z.number().int().positive(),
    sessionId: z.string().optional(),
  }),
});

export const SessionCreateLightweightSchema = z.object({
  action: z.literal('session_create_lightweight'),
  params: z.object({
    walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    sessionKey: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    dailySpendLimit: z.string().regex(/^\d+$/).optional(),
    dailyTxLimit: z.number().int().positive().optional(),
    expiry: z.number().int().positive(),
    allowedTargets: z.array(z.string().regex(/^0x[a-fA-F0-9]{40}$/)).max(32).optional(),
  }),
});

export const SessionRevokeSchema = z.object({
  action: z.literal('session_revoke'),
  params: z.object({
    sessionId: z.string().min(1),
    walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  }),
});

export const CredentialIssueSchema = z.object({
  action: z.literal('credential_issue'),
  params: z.object({
    organizationId: z.string().min(1),
    agentId: z.number().int().positive(),
    permissions: z.number().int().min(1).max(255).optional(),
    expiry: z.number().int().positive(),
    nullifier: z.string().optional(),
    secret: z.string().optional(),
  }),
});

export const CredentialRevokeSchema = z.object({
  action: z.literal('credential_revoke'),
  params: z.object({
    organizationId: z.string().min(1),
    agentId: z.number().int().positive(),
  }),
});

// Root ACCEPT / CANCEL actions (C-5 timelock). Accept takes no params:
// it completes whichever proposal is pending. Cancel likewise.
export const CredentialAcceptRootSchema = z.object({
  action: z.literal('credential_accept_root'),
  params: z.object({}).passthrough(),
});

export const CredentialAcceptRevokedRootSchema = z.object({
  action: z.literal('credential_accept_revoked_root'),
  params: z.object({}).passthrough(),
});

export const CredentialCancelRootSchema = z.object({
  action: z.literal('credential_cancel_root'),
  params: z.object({}).passthrough(),
});

export const CredentialCancelRevokedRootSchema = z.object({
  action: z.literal('credential_cancel_revoked_root'),
  params: z.object({}).passthrough(),
});

export const OrganizationRegisterSchema = z.object({
  action: z.literal('organization_register'),
  params: z.object({
    name: z.string().min(1).max(128),
    ownerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    organizationId: z.string().optional(),
  }),
});

export const CapabilityRegisterSchema = z.object({
  action: z.literal('capability_register'),
  params: z.object({
    action: z.string().min(1),
    capabilityId: z.string().optional(),
    expiresAt: z.number().int().positive().optional(),
  }),
});

export const DelegationCreateSchema = z.object({
  action: z.literal('delegation_create'),
  params: z.object({
    organizationId: z.string().min(1),
    delegator: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    delegatee: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    scope: z.string().min(1).max(128),
    maxValue: z.string().regex(/^\d+$/).optional(),
    expiry: z.number().int().positive(),
  }),
});

export const DelegationAcceptRootSchema = z.object({
  action: z.literal('delegation_accept_root'),
  params: z.object({
    delegator: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    scopeHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  }),
});

export const DelegationCancelRootSchema = z.object({
  action: z.literal('delegation_cancel_root'),
  params: z.object({
    delegator: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    scopeHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  }),
});

export const AnchorAcceptRootSchema = z.object({
  action: z.literal('anchor_accept_root'),
  params: z.object({
    anchorAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  }),
});

export const AnchorAcceptRevokedRootSchema = z.object({
  action: z.literal('anchor_accept_revoked_root'),
  params: z.object({
    anchorAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  }),
});

export const AnchorCancelRootSchema = z.object({
  action: z.literal('anchor_cancel_root'),
  params: z.object({
    anchorAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  }),
});

export const AnchorCancelRevokedRootSchema = z.object({
  action: z.literal('anchor_cancel_revoked_root'),
  params: z.object({
    anchorAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  }),
});

const SCHEMA_MAP: Record<string, z.ZodType> = {
  wallet_create: WalletCreateSchema,
  wallet_execute: WalletExecuteSchema,
  wallet_execute_batch: WalletExecuteBatchSchema,
  wallet_deposit: WalletDepositSchema,
  wallet_withdraw: WalletWithdrawSchema,
  session_create: SessionCreateSchema,
  session_create_lightweight: SessionCreateLightweightSchema,
  session_revoke: SessionRevokeSchema,
  credential_issue: CredentialIssueSchema,
  credential_revoke: CredentialRevokeSchema,
  credential_accept_root: CredentialAcceptRootSchema,
  credential_accept_revoked_root: CredentialAcceptRevokedRootSchema,
  credential_cancel_root: CredentialCancelRootSchema,
  credential_cancel_revoked_root: CredentialCancelRevokedRootSchema,
  organization_register: OrganizationRegisterSchema,
  capability_register: CapabilityRegisterSchema,
  delegation_create: DelegationCreateSchema,
  delegation_accept_root: DelegationAcceptRootSchema,
  delegation_cancel_root: DelegationCancelRootSchema,
  anchor_accept_root: AnchorAcceptRootSchema,
  anchor_accept_revoked_root: AnchorAcceptRevokedRootSchema,
  anchor_cancel_root: AnchorCancelRootSchema,
  anchor_cancel_revoked_root: AnchorCancelRevokedRootSchema,
};

export function getSchemaForAction(action: string): z.ZodType | undefined {
  return SCHEMA_MAP[action];
}

export function validateIntent(action: string, params: Record<string, unknown>): { valid: boolean; errors: string[] } {
  if (!KNOWN_ACTIONS.includes(action as (typeof KNOWN_ACTIONS)[number])) {
    return { valid: false, errors: [`Unknown action: ${action}`] };
  }

  const schema = getSchemaForAction(action);
  if (!schema) {
    return { valid: true, errors: [] };
  }

  const result = schema.safeParse({ action, params });
  if (result.success) {
    return { valid: true, errors: [] };
  }

  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
  };
}
