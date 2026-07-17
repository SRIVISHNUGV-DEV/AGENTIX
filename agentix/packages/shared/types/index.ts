// ── Organization ───────────────────────────────────────────────────────
export interface Organization {
  id: string;
  name: string;
  ownerAddress: string;
  credentialAnchor?: string;
  active: boolean;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface OrganizationRequest {
  id: string;
  name: string;
  ownerAddress: string;
  eip712Signature: string;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: number;
  expiresAt: number;
  metadata?: Record<string, unknown>;
}

// ── Credential ─────────────────────────────────────────────────────────
export interface Credential {
  id: number;
  credentialId: string;
  organizationId: string;
  agentId: number;
  nullifier: string;
  secret: string;
  permissions: number;
  expiry: number;
  revoked: boolean;
  revokedAt?: number;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

// ── Wallet ─────────────────────────────────────────────────────────────
export interface Wallet {
  id: number;
  walletAddress: string;
  ownerAddress: string;
  organizationId?: string;
  agentId?: number;
  entryPoint?: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

// ── Session ────────────────────────────────────────────────────────────
export interface Session {
  id: number;
  sessionId: string;
  walletAddress: string;
  sessionKey: string;
  organizationId?: string;
  sessionType: number;
  maxValue: string;
  dailySpendLimit: string;
  dailyTxLimit: number;
  expiry: number;
  revoked: boolean;
  revokedAt?: number;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

// ── Proof ──────────────────────────────────────────────────────────────
export interface Proof {
  id: number;
  proofHash: string;
  sessionId?: string;
  nullifier?: string;
  root?: string;
  revokedRoot?: string;
  publicSignals?: string;
  proofData?: string;
  valid?: boolean;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

// ── Capability ─────────────────────────────────────────────────────────
export interface Capability {
  id: number;
  capabilityId: string;
  organizationId: string;
  name: string;
  description?: string;
  hash: string;
  active: boolean;
  createdAt: number;
}

// ── Delegation ─────────────────────────────────────────────────────────
export interface Delegation {
  id: number;
  delegationId: string;
  organizationId: string;
  delegator: string;
  delegatee: string;
  scope: string;
  maxValue: string;
  expiry: number;
  active: boolean;
  createdAt: number;
}

// ── Backup ─────────────────────────────────────────────────────────────
export interface Backup {
  id: number;
  backupId: string;
  filename: string;
  size: number;
  checksum: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

// ── Tree ───────────────────────────────────────────────────────────────
export interface TreeSnapshot {
  organizationId: string;
  treeType: "active" | "revoked";
  epoch: number;
  root: string;
  data: string;
  createdAt: number;
}

export interface TreeStatus {
  organizationId: string;
  activeRoot: string;
  activeEpoch: number;
  activeLeaves: number;
  revokedRoot: string;
  revokedEpoch: number;
  revokedLeaves: number;
}

// ── Agent Action ───────────────────────────────────────────────────────
export interface AgentAction {
  id: number;
  timestamp: number;
  agent?: string;
  tool: string;
  intent: string;
  sessionId?: string;
  walletAddress?: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "AUTHORITY";
  txHash?: string;
  executionTime?: number;
  success: boolean;
  failureReason?: string;
  metadata?: Record<string, unknown>;
}

// ── Risk ───────────────────────────────────────────────────────────────
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "AUTHORITY";

// ── Config ─────────────────────────────────────────────────────────────
// AgentixConfig lives at src/core/config.ts — the single source of truth (it
// owns loadConfig/saveConfig/DEFAULT_CONFIG). A second copy previously lived
// here, unused and already divergent (missing x402, extra authority/dashboard).
// Removed to prevent schema drift; import the config type from ../core/config.

// ── Events ─────────────────────────────────────────────────────────────
export type AgentixEvent =
  | { type: "OrganizationRequested"; data: { requestId: string; name: string } }
  | { type: "OrganizationApproved"; data: { requestId: string; txHash?: string } }
  | { type: "OrganizationCreated"; data: { organizationId: string; name: string; txHash?: string; credentialAnchor?: string } }
  | { type: "OrganizationDeactivated"; data: { organizationId: string } }
  | { type: "CredentialIssued"; data: { credentialId: string; organizationId: string; agentId: number; txHash?: string } }
  | { type: "CredentialRevoked"; data: { organizationId: string; agentId: number } }
  | { type: "RootUpdated"; data: { organizationId: string; root: string; epoch: number } }
  | { type: "WalletCreated"; data: { walletAddress: string; ownerAddress: string; txHash?: string } }
  | { type: "WalletExecuted"; data: { walletAddress: string; target?: string; value?: string; txHash?: string; bundler?: string } }
  | { type: "SessionCreated"; data: { sessionId: string; walletAddress: string } }
  | { type: "SessionRevoked"; data: { sessionId: string } }
  | { type: "ActionExecuted"; data: { action: string; success: boolean } }
  | { type: "PolicyUpdated"; data: { walletAddress: string; policyId: string } }
  | { type: "ReplayBlocked"; data: { reason: string } }
  | { type: "TreeCorruptionDetected"; data: { organizationId: string; errors: string[] } }
  | { type: "BackupCreated"; data: { backupId: string; size: number } }
  | { type: "DelegationCreated"; data: { delegationId: string } }
  | { type: "DelegationRevoked"; data: { delegationId: string } }
  | { type: "CapabilityRegistered"; data: { capabilityId: string; name: string } }
  | { type: "ProofGenerated"; data: { proofHash: string } }
  | { type: "DiagnosticsRun"; data: { status: string } }
  | { type: "HealthCheckRun"; data: { status: string } }
  | { type: "IdentityRegistered"; data: { identityId: string; walletAddress: string; txHash?: string } }
  | { type: "MetadataUpdated"; data: { identityId: number; metadataRoot: string; txHash?: string } };

// ── Health ─────────────────────────────────────────────────────────────
export interface HealthCheck {
  name: string;
  status: "PASS" | "WARNING" | "ERROR";
  message: string;
}

export interface HealthResult {
  status: "HEALTHY" | "DEGRADED" | "UNHEALTHY";
  checks: HealthCheck[];
}

// ── Diagnostics ────────────────────────────────────────────────────────
export interface DiagnosticItem {
  label: string;
  value: string;
  status: "OK" | "WARNING" | "ERROR" | "INFO";
}

export interface DiagnosticSection {
  name: string;
  status: "OK" | "WARNING" | "ERROR";
  items: DiagnosticItem[];
}

export interface DiagnosticsResult {
  sections: DiagnosticSection[];
}
