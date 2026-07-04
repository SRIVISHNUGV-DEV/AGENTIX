export interface CapabilityConstraints {
  maxValue?: string;
  maxGas?: string;
  expiry: number;
  allowedTargets?: string[];
  dailyLimit?: string;
}

export interface CapabilityNode {
  capabilityId: string;
  actionHash: string;
  action: string;
  grantor: string;
  constraints: CapabilityConstraints;
  expiresAt: number;
  merkleProof?: string[];
  onChainVerified: boolean;
}

export interface DelegationEdge {
  from: string;
  to: string;
  scopeHash: string;
  scopeAction: string;
  expiresAt: number;
  merkleProof?: string[];
  depth: number;
  onChainVerified: boolean;
}

export interface CredentialNode {
  credentialId: string;
  organizationId: string;
  agentId: number;
  nullifier: string;
  permissions: number;
  expiry: number;
  revoked: boolean;
  merkleProof?: string[];
  onChainVerified: boolean;
}

export interface CapabilityGraph {
  agent: {
    identityId: number;
    walletAddress: string;
  };
  organization: {
    id: string;
    active: boolean;
  };
  capabilities: CapabilityNode[];
  delegations: DelegationEdge[];
  credentials: CredentialNode[];
  grantedActions: string[];
  restrictedActions: string[];
  missingActions: string[];
}

export interface ResolvedCapabilities extends CapabilityGraph {
  canExecute: boolean;
  missingExplicit: string[];
  mustDelegate: string[];
}
