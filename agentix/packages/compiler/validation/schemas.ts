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
  organization_register: OrganizationRegisterSchema,
  capability_register: CapabilityRegisterSchema,
  delegation_create: DelegationCreateSchema,
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
