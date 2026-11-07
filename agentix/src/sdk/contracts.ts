import { ethers, JsonRpcProvider, Signer, Contract } from 'ethers';
import { AgentIXConfig, SigningRequest } from './types';
import { RpcError, SignerRequiredError } from './errors';

const ABIS = {
  AgentWalletFactory: [
    'function createWallet(address owner) external returns (address wallet)',
    'function createWallet(address owner, bytes32 salt) external returns (address wallet)',
    'function getAddress(bytes32 salt) external view returns (address)',
    'function isAgentWallet(address) external view returns (bool)',
    'function setAgentIdentity(address) external',
    'function implementation() external view returns (address)',
    'function entryPoint() external view returns (address)',
    'function sessionManager() external view returns (address)',
    'function agentIdentity() external view returns (address)',
    'function proposeImplementation(address) external',
    'function acceptImplementation() external',
    'function proposeSessionManager(address) external',
    'function acceptSessionManager() external',
    'function proposeEntryPoint(address) external',
    'function acceptEntryPoint() external',
    'event WalletCreated(address indexed wallet, address indexed owner, bytes32 indexed salt, address entryPoint)',
  ],
  AgentIdentity: [
    'function registerIdentity(address wallet) external returns (uint256)',
    'function walletOf(uint256) external view returns (address)',
    'function identityOf(address) external view returns (uint256)',
    'function credentialOf(uint256) external view returns (uint256)',
    'function metadataOf(uint256) external view returns (bytes32)',
    'function linkCredential(uint256 identityId, uint256 credentialId) external',
    'function updateMetadata(uint256 identityId, bytes32 metadataRoot) external',
    'function deactivate(uint256 identityId) external',
    'function reactivate(uint256 identityId) external',
    'function ownerOfIdentity(uint256) external view returns (address)',
    'function exists(uint256) external view returns (bool)',
    'function isActive(uint256) external view returns (bool)',
    'function timestampsOf(uint256) external view returns (uint64, uint64)',
    'event IdentityRegistered(uint256 indexed identityId, address indexed wallet)',
    'event MetadataUpdated(uint256 indexed identityId, bytes32 metadataRoot)',
    'event IdentityDeactivated(uint256 indexed identityId)',
    'event IdentityReactivated(uint256 indexed identityId)',
    'event CredentialLinked(uint256 indexed identityId, uint256 indexed credentialId)',
  ],
  AgentWallet: [
    'function owner() external view returns (address)',
    'function sessionManager() external view returns (address)',
    'function entryPoint() external view returns (address)',
    'function execute(address target, uint256 value, bytes calldata data) external',
    'function executeBatch(address[] calldata targets, uint256[] calldata values, bytes[] calldata data) external',
    'function changeOwner(address newOwner) external',
    'function acceptOwnership() external',
    'function addDeposit() external payable',
    'function withdrawDepositTo(address payable, uint256) external',
    'function checkBalance() external view returns (uint256)',
    'function getDeposit() external view returns (uint256)',
    'function proposeSessionManager(address) external',
    'function acceptSessionManager() external',
    'function proposeEntryPoint(address) external',
    'function acceptEntryPoint() external',
    'event ExecutionPerformed(address indexed caller, address indexed target, uint256 value, bytes32 dataHash)',
    'event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner)',
    'event OwnerChanged(address indexed oldOwner, address indexed newOwner)',
  ],
  SessionManager: [
    'function createSession(bytes32 sessionId, address wallet, address sessionKey, uint128 maxValue, uint64 expiry, uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256[7] calldata publicSignals) external',
    'function createLightweightSession(bytes32 sessionId, address sessionKey, uint256 dailySpendLimit, uint256 dailyTxLimit, uint64 expiry, address[] calldata allowedTargets, bytes calldata ownerSignature) external',
    'function revokeSession(bytes32 sessionId, address wallet) external',
    'function revokeLightweightSession(bytes32 sessionId, address wallet) external',
    'function getSessionType(bytes32) external view returns (uint8)',
    'function sessions(bytes32) external view returns (address wallet, address sessionKey, uint256 valueUsed, uint256 maxValue, uint64 expiry, bool revoked)',
    'function getLightSession(bytes32 sessionId) external view returns (address sessionWallet, address sessionKey, uint256 dailySpendLimit, uint256 dailyTxLimit, uint256 dailySpendUsed, uint256 dailyTxUsed, uint64 expiry, bool revoked)',
    'function getWalletSessions(address) external view returns (bytes32[])',
    'function getSessionTargets(bytes32) external view returns (address[])',
    'function setSessionTargets(bytes32 sessionId, address[] targets) external',
    'function validateSession(bytes32 sessionId, address signer, uint256 value, address target, bytes data) external view returns (bool)',
    'function validateLightweightSession(bytes32 sessionId, address signer, uint256 value, address target, bytes data) external view returns (bool)',
    'function pruneExpiredSessions(address wallet, uint256 limit) external',
    'event SessionCreated(bytes32 indexed sessionId, address indexed wallet, address indexed sessionKey, uint64 expiry, uint128 maxValue, bytes32 nullifier)',
    'event SessionRevoked(bytes32 indexed sessionId)',
    'event LightSessionCreated(bytes32 indexed sessionId, address indexed wallet, address indexed sessionKey, uint256 dailySpendLimit, uint256 dailyTxLimit, uint64 expiry)',
    'event LightSessionRevoked(bytes32 indexed sessionId)',
  ],
  CredentialRegistry: [
    'function proposeActiveRoot(bytes32 newRoot) external',
    'function acceptActiveRoot() external',
    'function cancelActiveRoot() external',
    'function proposeRevokedSecretRoot(bytes32 newRoot) external',
    'function acceptRevokedSecretRoot() external',
    'function cancelRevokedSecretRoot() external',
    'function pendingActiveRoot() external view returns (bytes32)',
    'function pendingRevokedSecretRoot() external view returns (bytes32)',
    'function markNullifierUsed(bytes32 nullifier) external',
    'function isNullifierUsed(bytes32) external view returns (bool)',
    'function activeRoot() external view returns (bytes32)',
    'function revokedSecretRoot() external view returns (bytes32)',
    'function issuers(address) external view returns (bool)',
    'function addIssuer(address) external',
    'function removeIssuer(address) external',
    'function setSessionManager(address, bool) external',
    'event ActiveRootUpdated(bytes32 indexed newRoot)',
    'event RevokedSecretRootUpdated(bytes32 indexed newRoot)',
  ],
  DelegationManager: [
    'function proposeDelegationRoot(address delegator, bytes32 scopeHash, bytes32 newRoot, uint64 expiresAt) external',
    'function acceptDelegationRoot(address delegator, bytes32 scopeHash) external',
    'function cancelDelegationRoot(address delegator, bytes32 scopeHash) external',
    'function pendingDelegationRoots(address, bytes32) external view returns (bytes32 root, uint64 expiresAt, uint256 activationTime, bool exists)',
    'function revokeDelegation(bytes32 delegationLeafHash, address delegator) external',
    'function verifyDelegation(bytes32 delegationLeaf, bytes32[] calldata merkleProof, address delegator, bytes32 scopeHash, uint64 expiresAt, uint8 maxDepth) external view returns (bool)',
    'function verifyDelegationChain(bytes32[] calldata delegationLeaves, bytes32[][] calldata merkleProofs, address[] calldata delegators, address[] calldata delegates, bytes32[] calldata scopeHashes, uint64[] calldata expiries, uint8[] calldata maxDepths) external view returns (bool)',
    'function getDelegationRoot(address, bytes32) external view returns (bytes32 root, uint64 expiresAt, uint64 createdAt)',
    'function isRevoked(address delegator, bytes32 leafHash) external view returns (bool)',
    'function scopeActions(bytes32) external view returns (string)',
    'function setRootUpdater(address, bool) external',
    'function emergencyRevokeAll(address) external',
    'function reAuthorizeDelegator(address) external',
    'function registerScope(string calldata) external',
    'event DelegationRootUpdated(address indexed delegator, bytes32 indexed scopeHash, bytes32 newRoot, uint64 expiresAt)',
    'event DelegationRevoked(bytes32 indexed delegationLeafHash, address indexed delegator)',
  ],
  CapabilityRegistry: [
    'function registerCapability(bytes32 capabilityId, string calldata action, uint64 expiresAt) external',
    'function revokeCapability(bytes32 capabilityId) external',
    'function updateGrantRoot(address grantee, bytes32 capabilityId, bytes32 newRoot) external',
    'function revokeGrant(bytes32 grantLeafHash, bytes32 capabilityId, address grantor, address grantee) external',
    'function verifyCapability(address agent, bytes32 capabilityId, bytes32 grantLeaf, bytes32[] calldata merkleProof, address grantor, bytes32 constraintsHash, uint64 expiresAt) external view returns (bool)',
    'function capabilities(bytes32) external view returns (bytes32 actionHash, address registrar, uint64 createdAt, uint64 expiresAt, bool revoked)',
    'event CapabilityRegistered(bytes32 indexed capabilityId, bytes32 indexed actionHash, address indexed registrar)',
    'event CapabilityRevoked(bytes32 indexed capabilityId)',
    'event GrantRootUpdated(address indexed grantor, address indexed grantee, bytes32 indexed capabilityId, bytes32 newRoot)',
  ],
  OrganizationRegistry: [
    'function registerOrganization(bytes32 organizationId, string calldata name, address owner) external',
    'function deactivateOrganization(bytes32) external',
    'function reactivateOrganization(bytes32) external',
    'function getOrganization(bytes32) external view returns (tuple(bytes32 organizationId, string name, address owner, address credentialAnchor, bool active, uint64 createdAt))',
    'function organizationExists(bytes32) external view returns (bool)',
    'function isActive(bytes32) external view returns (bool)',
    'function getCredentialAnchor(bytes32) external view returns (address)',
    'function getOwnerOrganizations(address) external view returns (bytes32[])',
    'function proposeCredentialAnchor(bytes32, address) external',
    'function acceptCredentialAnchor(bytes32) external',
    'event OrganizationRegistered(bytes32 indexed organizationId, string name, address indexed owner, address credentialAnchor)',
  ],
  OrganizationCredentialAnchor: [
    'function proposeRoot(bytes32 newRoot) external',
    'function acceptRoot() external',
    'function cancelRoot() external',
    'function proposeRevokedRoot(bytes32 newRoot) external',
    'function acceptRevokedRoot() external',
    'function cancelRevokedRoot() external',
    'function pendingRoot() external view returns (bytes32)',
    'function pendingRevokedRoot() external view returns (bytes32)',
    'function incrementEpoch() external',
    'function setVisibility(uint8) external',
    'function setMetadataHash(bytes32) external',
    'function currentRoot() external view returns (bytes32)',
    'function revokedRoot() external view returns (bytes32)',
    'function currentEpoch() external view returns (uint64)',
    'function metadataHash() external view returns (bytes32)',
    'function organizationId() external view returns (bytes32)',
    'function getRoots() external view returns (bytes32, bytes32)',
    'event RootUpdated(bytes32 indexed organizationId, bytes32 oldRoot, bytes32 newRoot)',
    'event EpochIncremented(bytes32 indexed organizationId, uint64 newEpoch)',
    'event VisibilityChanged(bytes32 indexed organizationId, uint8 newVisibility)',
  ],
};

export type ContractName = keyof typeof ABIS;

export class ContractRegistry {
  readonly provider: JsonRpcProvider;
  readonly fallbackProvider?: JsonRpcProvider;
  readonly signer?: Signer;

  /**
   * Connects to the configured RPC (plus fallback) and remembers the caller's signer, if any.
   * AgentIX never holds private keys — the signer is supplied by the caller (wallet provider, JsonRpcSigner, etc.).
   * @param signer - Optional ethers Signer for writes; omit for a read-only registry (send() then returns provider-bound contracts).
   * Maps to: internal — AgentIX constructor.
   * Side effects: opens JSON-RPC provider connections (no network calls yet; staticNetwork skips the chain-id probe).
   */
  constructor(
    public readonly config: AgentIXConfig,
    signer?: Signer,
  ) {
    this.provider = new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true });
    if (config.rpcFallbackUrl) {
      this.fallbackProvider = new JsonRpcProvider(config.rpcFallbackUrl, config.chainId, { staticNetwork: true });
    }
    this.signer = signer;
  }

  /**
   * Runs a read against the primary RPC and retries it against the fallback RPC on failure.
   * Use for reads where a single RPC outage should not fail the call; writes must never go through here (a retried write can double-submit).
   * @param fallback - Optional fallback closure; without one the primary error is rethrown.
   * @returns Whatever the successful closure returns.
   * @throws The primary error when there is no fallback, or the fallback's error when both fail.
   * Maps to: internal — blockchain adapter read functions (readOracleState and friends).
   */
  async callWithFallback<T>(primary: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    try {
      return await primary();
    } catch (err: any) {
      if (fallback) return await fallback();
      throw err;
    }
  }

  /**
   * Returns a read-only contract connected to the JSON-RPC provider.
   * The address comes from config (<Name>Address) unless an explicit address is passed (e.g. a per-wallet AgentWallet instance).
   * @returns A provider-bound ethers Contract; calling a state-changing method on it throws at call time.
   * @throws RpcError when no address is configured for the contract.
   * Maps to: contract — the named contract's view functions.
   */
  get<T extends Contract>(name: ContractName, address?: string): T {
    const addr = address || (this.config as any)[name + 'Address'];
    if (!addr) throw new RpcError('No address configured for ' + name);
    return new Contract(addr, ABIS[name], this.provider) as unknown as T;
  }

  /**
   * Returns a write-capable contract connected to the user's Signer.
   * AgentIX never holds private keys — the Signer is provided by the caller.
   * NOTE: when no signer was supplied this silently returns a provider-bound (read-only) contract instead of throwing, so the failure only surfaces as a revert/throw when a write is attempted — prefer hasSigner() checks at the call site.
   * @returns A signer-bound ethers Contract (or provider-bound when there is no signer).
   * @throws RpcError when no address is configured for the contract.
   * Maps to: contract — the named contract's state-changing functions.
   * Security: every write this returns goes through the caller's signer; the signer is the authority.
   */
  send<T extends Contract>(name: ContractName, address?: string): T {
    const addr = address || (this.config as any)[name + 'Address'];
    if (!addr) throw new RpcError('No address configured for ' + name);
    if (!this.signer) {
      return new Contract(addr, ABIS[name], this.provider) as unknown as T;
    }
    return new Contract(addr, ABIS[name], this.signer) as unknown as T;
  }

  /**
   * Checks whether a signer is available.
   * Call before any write path to fail fast with a clear error instead of hitting the silent read-only fallback in send().
   * @returns True when a signer was supplied to the constructor.
   * Maps to: internal — AgentIX.hasSigner.
   */
  hasSigner(): boolean {
    return !!this.signer;
  }

  /**
   * Returns the signer's address, or throws if no signer.
   * WARNING: this is a stub — it always returns the literal '0x' when a signer exists, because a sync method cannot await Signer.getAddress(). Use getSignerAddressAsync() instead; this method has no internal callers.
   * @returns The literal string '0x' (not a real address).
   * @throws SignerRequiredError when no signer was supplied.
   * Maps to: internal — superseded by getSignerAddressAsync.
   */
  getSignerAddress(): string {
    if (!this.signer) throw new SignerRequiredError('getSignerAddress');
    return '0x';
  }

  /**
   * Returns the signer's real address (async, because ethers signers resolve it).
   * The correct way to learn who is signing; prefer it over the sync getSignerAddress stub.
   * @returns The checksummed signer address.
   * @throws SignerRequiredError when no signer was supplied.
   * Maps to: internal — AgentIX.getSignerAddress.
   */
  async getSignerAddressAsync(): Promise<string> {
    if (!this.signer) throw new SignerRequiredError('getSignerAddress');
    return await this.signer.getAddress();
  }

  /**
   * Builds a human-readable signing request for display before the user signs.
   * The risk label is a heuristic on the function name (execute/changeOwner = danger, create/update/revoke = warning, else info) — it is a UI hint, not a security verdict.
   * @param name - Registry contract name; @param value - ETH value in wei, rendered as an ETH string when present.
   * @returns The SigningRequest describing target contract, function, args, value, and risk.
   * Maps to: internal — SDK signing-confirmation UI.
   */
  describe(
    name: ContractName,
    functionName: string,
    args: Record<string, string>,
    value?: bigint,
  ): SigningRequest {
    const address = (this.config as any)[name + 'Address'] || 'custom';
    return {
      description: name + '.' + functionName + '()',
      targetContract: address,
      functionName,
      args,
      value: value != null ? ethers.formatEther(value) + ' ETH' : undefined,
      risk: functionName === 'execute' || functionName === 'executeBatch' || functionName === 'changeOwner'
        ? 'danger'
        : functionName.startsWith('update') || functionName.startsWith('create') || functionName.startsWith('revoke')
          ? 'warning'
          : 'info',
    };
  }
}
