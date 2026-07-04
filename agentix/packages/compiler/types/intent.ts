import { z } from 'zod';

export const IntentSource = {
  CLI: 'cli',
  SDK: 'sdk',
  REST: 'rest',
  MCP: 'mcp',
  DASHBOARD: 'dashboard',
  NL: 'nl',
} as const;
export type IntentSource = (typeof IntentSource)[keyof typeof IntentSource];

export const IntentPriority = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
} as const;
export type IntentPriority = (typeof IntentPriority)[keyof typeof IntentPriority];

export interface StructuredIntent {
  action: string;
  params: Record<string, unknown>;
  source: IntentSource;
  metadata?: Record<string, unknown>;
}

export const StructuredIntentSchema = z.object({
  action: z.string().min(1),
  params: z.record(z.unknown()),
  source: z.enum(['cli', 'sdk', 'rest', 'mcp', 'dashboard', 'nl']),
  metadata: z.record(z.unknown()).optional(),
});

export interface IntentIR {
  version: 1;
  id: string;
  source: IntentSource;
  action: string;
  params: Record<string, unknown>;
  agent?: {
    identityId: number;
    walletAddress: string;
  };
  organizationId?: string;
  sessionId?: string;
  limits?: {
    maxValue?: string;
    maxGas?: string;
    expiry?: number;
  };
  targets?: string[];
  requestedAt: number;
  priority: IntentPriority;
  idempotencyKey?: string;
}

export interface ParsedIntent extends IntentIR {
  normalizedAction: string;
  validationErrors: string[];
}

export const KNOWN_ACTIONS = [
  'wallet_create',
  'wallet_execute',
  'wallet_execute_batch',
  'wallet_deposit',
  'wallet_withdraw',
  'wallet_transfer_ownership',
  'session_create',
  'session_create_lightweight',
  'session_revoke',
  'session_validate',
  'credential_issue',
  'credential_revoke',
  'credential_update_root',
  'organization_register',
  'organization_deactivate',
  'organization_reactivate',
  'capability_register',
  'capability_revoke',
  'capability_grant',
  'capability_revoke_grant',
  'delegation_create',
  'delegation_revoke',
  'identity_link_credential',
  'identity_update_metadata',
  'identity_deactivate',
  'identity_reactivate',
  'proof_generate',
  'proof_verify',
] as const;
export type KnownAction = (typeof KNOWN_ACTIONS)[number];

export const NL_PATTERNS: { pattern: RegExp; action: KnownAction; extract: (m: RegExpExecArray) => Record<string, unknown> }[] = [
  {
    pattern: /send\s+(\d+(?:\.\d+)?)\s*(?:ETH|eth)\s+to\s+(0x[a-fA-F0-9]{40})/i,
    action: 'wallet_execute',
    extract: (m) => ({ value: m[1], target: m[2] }),
  },
  {
    pattern: /create\s+(?:a\s+)?wallet\s+(?:for\s+)?(0x[a-fA-F0-9]{40})/i,
    action: 'wallet_create',
    extract: (m) => ({ ownerAddress: m[1] }),
  },
  {
    pattern: /create\s+(?:a\s+)?session\s+(?:for|on)\s+(?:wallet\s+)?(0x[a-fA-F0-9]{40})/i,
    action: 'session_create_lightweight',
    extract: (m) => ({ walletAddress: m[1] }),
  },
  {
    pattern: /revoke\s+session\s+(0x[a-fA-F0-9]{64})/i,
    action: 'session_revoke',
    extract: (m) => ({ sessionId: m[1] }),
  },
  {
    pattern: /issue\s+(?:a\s+)?credential\s+(?:to\s+)?(?:agent\s+)?(\d+)/i,
    action: 'credential_issue',
    extract: (m) => ({ agentId: parseInt(m[1]) }),
  },
  {
    pattern: /revoke\s+credential\s+(?:of|for)\s+(?:agent\s+)?(\d+)/i,
    action: 'credential_revoke',
    extract: (m) => ({ agentId: parseInt(m[1]) }),
  },
  {
    pattern: /register\s+(?:organization|org)\s+"([^"]+)"/i,
    action: 'organization_register',
    extract: (m) => ({ name: m[1] }),
  },
  {
    pattern: /deactivate\s+(?:organization|org)\s+(0x[a-fA-F0-9]{64})/i,
    action: 'organization_deactivate',
    extract: (m) => ({ organizationId: m[1] }),
  },
  {
    pattern: /register\s+capability\s+"([^"]+)"/i,
    action: 'capability_register',
    extract: (m) => ({ action: m[1] }),
  },
  {
    pattern: /create\s+delegation\s+(?:from\s+)?(0x[a-fA-F0-9]{40})\s+(?:to\s+)?(0x[a-fA-F0-9]{40})/i,
    action: 'delegation_create',
    extract: (m) => ({ delegator: m[1], delegatee: m[2] }),
  },
];
