import { z } from "zod";

export const OrganizationRequestSchema = z.object({
  name: z.string().min(1).max(128),
  ownerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

// Matches the real issueCredential() tool signature (src/tools/credential.ts).
// Credentials are org-scoped; budget is an ETH decimal string; expiry is a
// duration + unit that the tool converts to a block number.
export const CredentialIssueSchema = z.object({
  orgId: z.string().min(1),
  budgetLimit: z.string().min(1),
  expiryDuration: z.number().int().positive(),
  expiryUnit: z.enum(["days", "months"]),
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  ownerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  autoAnchor: z.boolean().optional(),
});

export const WalletCreateSchema = z.object({
  ownerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

export const SessionCreateSchema = z.object({
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  sessionKey: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  dailySpendLimit: z.string().default("1000000000000000000"),
  dailyTxLimit: z.number().int().positive().default(100),
  expiry: z.number().int().positive(),
});

export const ProofGenerateSchema = z.object({
  organizationId: z.string().min(1),
  agentId: z.number().int().positive(),
  nullifier: z.string().min(1),
  secret: z.string().min(1),
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  expiry: z.number().int().positive(),
});

export const DelegationCreateSchema = z.object({
  organizationId: z.string().min(1),
  delegator: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  delegatee: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  scope: z.string().min(1).max(128),
  maxValue: z.string().default("0"),
  expiry: z.number().int().positive(),
});

export const BackupCreateSchema = z.object({
  description: z.string().optional(),
});

export const ConfigSetSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
});

/**
 * Config fields the dashboard/API is allowed to write at runtime. Everything is
 * optional (callers PATCH one or two keys at a time) but each field is
 * type-checked so a stray `rpcUrl: 12345` or an unknown key can't poison the
 * runtime config. `.strict()` rejects unknown keys outright.
 */
export const ConfigUpdateSchema = z
  .object({
    rpcUrl: z.string().url().or(z.literal("")).optional(),
    rpcFallbackUrl: z.string().url().or(z.literal("")).optional(),
    networkName: z.string().min(1).max(64).optional(),
    chainId: z.number().int().positive().optional(),
    developerMode: z.boolean().optional(),
  })
  .strict();

/** POST /api/capabilities — register a capability (org-scoped, off-chain record). */
export const CapabilityCreateSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
  organizationId: z.string().min(1).max(128).optional(),
});

/** POST /api/delegations — create a delegation record. */
export const DelegationRequestSchema = z.object({
  organizationId: z.string().min(1).max(128).optional(),
  delegator: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  delegatee: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  scope: z.string().min(1).max(128),
  maxValue: z.string().regex(/^\d+$/).optional(),
  expiry: z.number().int().positive().optional(),
});

/** POST /api/sessions — create a session via the service layer. */
export const SessionCreateRequestSchema = z.object({
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  sessionKey: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  ownerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  organizationId: z.string().optional(),
  dailySpendLimit: z.string().optional(),
  dailyTxLimit: z.number().int().positive().optional(),
  expiry: z.number().int().positive().optional(),
});

/** DELETE /api/sessions — revoke a session. */
export const SessionRevokeSchema = z.object({
  sessionId: z.string().min(1),
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

/** POST /api/wallets — create/register a wallet for an owner. */
export const WalletCreateRequestSchema = z.object({
  ownerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  harnessId: z.string().max(128).optional(),
});

export type OrganizationRequestInput = z.infer<typeof OrganizationRequestSchema>;
export type CredentialIssueInput = z.infer<typeof CredentialIssueSchema>;
export type WalletCreateInput = z.infer<typeof WalletCreateSchema>;
export type SessionCreateInput = z.infer<typeof SessionCreateSchema>;
export type ProofGenerateInput = z.infer<typeof ProofGenerateSchema>;
export type DelegationCreateInput = z.infer<typeof DelegationCreateSchema>;
