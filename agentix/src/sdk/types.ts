import type { ContractTransactionReceipt, Signer } from 'ethers';

export interface ExecuteRequest {
  target: string;
  value: bigint;
  data: string;
}

export interface BatchExecuteRequest {
  targets: string[];
  values: bigint[];
  data: string[];
}

export interface WalletInfo {
  address: string;
  owner: string;
  sessionManager: string;
  entryPoint: string;
}

export interface IdentityInfo {
  identityId: bigint;
  wallet: string;
  credentialId: bigint;
  metadataRoot: string;
  createdAt: number;
  updatedAt: number;
  active: boolean;
}

export type SessionType = 'standard' | 'lightweight' | 'none';

export interface StandardSession {
  sessionId: string;
  wallet: string;
  sessionKey: string;
  valueUsed: bigint;
  maxValue: bigint;
  expiry: number;
  revoked: boolean;
}

export interface LightweightSession {
  sessionId: string;
  wallet: string;
  sessionKey: string;
  dailySpendLimit: bigint;
  dailyTxLimit: bigint;
  dailySpendUsed: bigint;
  dailyTxUsed: bigint;
  lastResetDay: number;
  expiry: number;
  revoked: boolean;
  allowedTargets: string[];
}

export interface CreateStandardSessionParams {
  sessionId: string;
  wallet: string;
  sessionKey: string;
  maxValue: bigint;
  expiry: number;
  a: [bigint, bigint];
  b: [[bigint, bigint], [bigint, bigint]];
  c: [bigint, bigint];
  publicSignals: [bigint, bigint, bigint, bigint, bigint, bigint, bigint];
}

export interface CreateLightSessionParams {
  sessionId: string;
  sessionKey: string;
  dailySpendLimit: bigint;
  dailyTxLimit: bigint;
  expiry: number;
  allowedTargets: string[];
  /** EIP-191 or EIP-712 signature from the wallet owner authorising this session */
  ownerSignature?: string;
}

export interface OrganizationInfo {
  organizationId: string;
  name: string;
  owner: string;
  credentialAnchor: string;
  active: boolean;
  createdAt: number;
}

export interface CredentialAnchorInfo {
  organizationId: string;
  currentRoot: string;
  revokedRoot: string;
  currentEpoch: number;
  metadataHash: string;
  visibility: 'PRIVATE' | 'PUBLIC';
}

export interface CredentialRegistryInfo {
  activeRoot: string;
  revokedSecretRoot: string;
  issuers: string[];
  sessionManagers: string[];
}

export interface CapabilityDef {
  capabilityId: string;
  actionHash: string;
  action: string;
  registrar: string;
  createdAt: number;
  expiresAt: number;
  revoked: boolean;
}

export interface DelegationRoot {
  root: string;
  expiresAt: number;
  createdAt: number;
}

export interface DelegationChainLink {
  delegationLeaf: string;
  merkleProof: string[];
  delegator: string;
  delegate: string;
  scopeHash: string;
  expiresAt: number;
  maxDepth: number;
}

export interface IndexedEvent {
  id: string;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  eventName: string;
  contractAddress: string;
  args: Record<string, unknown>;
  timestamp?: number;
}

export interface TransactionResult {
  hash: string;
  receipt: ContractTransactionReceipt | null;
  events: IndexedEvent[];
}

export interface PendingTransaction {
  hash: string;
  description: string;
  status: 'pending' | 'confirmed' | 'failed';
}

/** Describes a signing request before the user commits to it. */
export interface SigningRequest {
  /** High-level description of what this operation does. */
  description: string;
  /** Target contract that will be called. */
  targetContract: string;
  /** Which contract function is being invoked. */
  functionName: string;
  /** The function arguments in human-readable format. */
  args: Record<string, string>;
  /** ETH value being sent (if any). */
  value?: string;
  /** Risk assessment: 'info' for read-only, 'warning' for state changes, 'danger' for owner ops */
  risk: 'info' | 'warning' | 'danger';
}

export interface AgentIXConfig {
  rpcUrl: string;
  chainId: number;
  walletFactoryAddress: string;
  agentIdentityAddress?: string;
  sessionManagerAddress: string;
  credentialRegistryAddress: string;
  credentialVerifierAddress: string;
  delegationManagerAddress: string;
  capabilityRegistryAddress: string;
  organizationRegistryAddress: string;
  entryPointAddress: string;
  dbPath?: string;
}

/** Chain constants */
export const CHAINS = {
  BASE_SEPOLIA: { chainId: 84532, name: 'Base Sepolia' },
} as const;
