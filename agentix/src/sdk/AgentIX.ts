import { Signer } from 'ethers';
import { AgentIXConfig } from './types';
import { SignerRequiredError } from './errors';
import { loadConfig } from './config';
import { ContractRegistry } from './contracts';
import { Database } from './database';
import { TransactionManager } from './transaction';
import { WalletModule } from './wallet';
import { IdentityModule } from './identity';
import { SessionModule } from './session';
import { CredentialModule } from './credential';
import { OrganizationModule } from './organization';
import { CapabilityModule } from './capability';
import { DelegationModule } from './delegation';
import { EventIndexer } from './events';
import { OwnerModule } from './onlyOwner/index';

export class AgentIX {
  readonly contracts: ContractRegistry;
  readonly db: Database;
  readonly tx: TransactionManager;

  readonly wallet: WalletModule;
  readonly identity: IdentityModule;
  readonly sessions: SessionModule;
  readonly credentials: CredentialModule;
  readonly organizations: OrganizationModule;
  readonly capabilities: CapabilityModule;
  readonly delegations: DelegationModule;
  readonly events: EventIndexer;

  /** Protocol admin operations — requires the contract owner's signer. */
  readonly owner: OwnerModule;

  readonly config: AgentIXConfig;

  /**
   * Creates the AgentIX SDK instance.
   * One instance owns the config, the contract registry, the local DB, the transaction manager, and every module — construct it once and reuse it.
   * @param configOrOverrides - Contract addresses and RPC configuration; env vars and built-in Base Sepolia defaults fill the gaps (see loadConfig).
   * @param signer - An ethers Signer from the user's wallet provider. AgentIX NEVER asks for or stores private keys.
   * @returns A ready AgentIX instance; no chain calls happen here.
   * @throws ConfigurationError when required addresses are missing after merging defaults, env, and overrides.
   * Maps to: CLI 'agentix' (every command builds one); MCP tool agentix_health.
   * Side effects: opens the local JSON DB (creating .agentix/db.json when absent) and starts its 5s flush timer.
   */
  constructor(
    configOrOverrides?: Partial<AgentIXConfig>,
    signer?: Signer,
  ) {
    this.config = loadConfig(configOrOverrides);
    this.contracts = new ContractRegistry(this.config, signer);
    this.db = new Database(this.config.dbPath);
    this.tx = new TransactionManager(this.contracts, this.db);

    this.wallet = new WalletModule(this.contracts, this.tx, this.db);
    this.identity = new IdentityModule(this.contracts, this.tx, this.db);
    this.sessions = new SessionModule(this.contracts, this.tx, this.db);
    this.credentials = new CredentialModule(this.contracts, this.tx, this.db);
    this.organizations = new OrganizationModule(this.contracts, this.tx, this.db);
    this.capabilities = new CapabilityModule(this.contracts, this.tx, this.db);
    this.delegations = new DelegationModule(this.contracts, this.tx, this.db);
    this.events = new EventIndexer(this.contracts, this.db);
    this.owner = new OwnerModule(this.contracts, this.tx, this.db);
  }

  /**
   * Returns the connected signer's address.
   * @returns The checksummed signer address.
   * @throws SignerRequiredError when the SDK was constructed without a signer.
   * Maps to: internal — ContractRegistry.getSignerAddressAsync.
   */
  async getSignerAddress(): Promise<string> {
    return this.contracts.getSignerAddressAsync();
  }

  /**
   * Returns the chain id this SDK instance is configured for (Base Sepolia: 84532).
   * @returns The configured chain id.
   * Maps to: internal — AgentIX.config.chainId.
   */
  getChainId(): number {
    return this.config.chainId;
  }

  /**
   * Returns the SDK version string.
   * @returns '1.0.0' (hardcoded; not read from package.json).
   * Maps to: internal — CLI 'agentix --version' (which resolves its own version separately).
   */
  getVersion(): string {
    return '1.0.0';
  }

  /**
   * Reports whether this SDK instance can sign (i.e. a signer was supplied).
   * Check before any write: without a signer every send() degrades to a read-only contract.
   * @returns True when a signer is present.
   * Maps to: internal — ContractRegistry.hasSigner.
   */
  hasSigner(): boolean {
    return this.contracts.hasSigner();
  }

  /**
   * Deploys a new AgentWallet for an owner.
   * Thin facade over WalletModule.create — see it for the event-recovery detail.
   * @returns The deployed wallet's WalletInfo.
   * @throws When the factory call reverts or the creation event is not found.
   * Maps to: contract AgentWalletFactory.createWallet; CLI 'agentix wallet' create; MCP tool agentix_wallet_create.
   * Side effects: deploys a contract on-chain (gas).
   */
  async createWallet(owner: string) {
    return this.wallet.create(owner);
  }

  /**
   * Deploys a wallet for an owner and then reads back the identity the factory registered for it.
   * Two steps, not one: the wallet must exist on-chain before its identity can be looked up, so a failure in the second step still leaves a deployed wallet behind.
   * @returns { wallet, identity } — the new wallet info and its on-chain identity.
   * @throws When wallet creation fails, or when no identity is registered for the new wallet.
   * Maps to: contract AgentWalletFactory.createWallet + AgentIdentity.identityOf.
   * Side effects: deploys a contract on-chain (gas); caches wallet and identity locally.
   */
  async createIdentity(owner: string) {
    const walletInfo = await this.wallet.create(owner);
    const identityInfo = await this.identity.getByWallet(walletInfo.address);
    return { wallet: walletInfo, identity: identityInfo };
  }

  /**
   * Executes one call from a wallet as the wallet itself.
   * Thin facade over WalletModule.execute — see it for the authorization and security notes.
   * @param value - ETH value in wei, spent from the wallet's balance.
   * @returns The mined transaction result.
   * @throws When the caller is not authorized or the inner call reverts.
   * Maps to: contract AgentWallet.execute; MCP tool agentix_wallet_execute.
   * Side effects: moves ETH and calls an arbitrary contract — value transfer.
   */
  async execute(wallet: string, target: string, value: bigint, data: string) {
    return this.wallet.execute(wallet, { target, value, data });
  }

  /**
   * Executes several calls from a wallet in one transaction (1-20 calls, atomic).
   * Thin facade over WalletModule.executeBatch.
   * @returns The mined transaction result.
   * @throws ValidationError when the batch is empty or over 20 calls; contract errors when any inner call reverts.
   * Maps to: contract AgentWallet.executeBatch.
   * Side effects: moves ETH and calls arbitrary contracts — value transfer; atomic (all or nothing).
   */
  async executeBatch(wallet: string, targets: string[], values: bigint[], data: string[]) {
    return this.wallet.executeBatch(wallet, { targets, values, data });
  }

  /**
   * Starts a wallet ownership transfer to a new owner (two-step: the new owner must still accept).
   * Thin facade over WalletModule.changeOwner — ownership does NOT move until acceptOwnership.
   * @returns The mined transaction result for the transfer-start.
   * @throws When the caller is not the current owner.
   * Maps to: contract AgentWallet.changeOwner; event OwnershipTransferStarted.
   */
  async transferWalletOwnership(wallet: string, newOwner: string) {
    return this.wallet.changeOwner(wallet, newOwner);
  }

  /**
   * Proposes a new credential root (effective after the 2-day timelock + accept — NOT an instant update).
   * Thin facade over CredentialModule.proposeActiveRoot.
   * @returns The mined transaction result for the proposal.
   * @throws ValidationError on a zero root; TimelockActive when a proposal is already pending.
   * Maps to: contract CredentialRegistry.proposeActiveRoot.
   * Security: registry-owner only.
   */
  async proposeCredentialRoot(newRoot: string) {
    return this.credentials.proposeActiveRoot(newRoot);
  }

  /**
   * Accepts a pending credential root after the 2-day timelock.
   * Thin facade over CredentialModule.acceptActiveRoot — this is the step that actually changes the live root.
   * @returns The mined transaction result.
   * @throws TimelockNotReady when the delay has not elapsed.
   * Maps to: contract CredentialRegistry.acceptActiveRoot; event ActiveRootUpdated.
   * Security: registry-owner only.
   */
  async acceptCredentialRoot() {
    return this.credentials.acceptActiveRoot();
  }

  /**
   * Proposes a new revoked-secret root (effective after the 2-day timelock + accept).
   * Thin facade over CredentialModule.proposeRevokedSecretRoot.
   * @returns The mined transaction result for the proposal.
   * @throws ValidationError on a zero root; TimelockActive when a proposal is already pending.
   * Maps to: contract CredentialRegistry.proposeRevokedSecretRoot.
   * Security: registry-owner only.
   */
  async proposeRevokedCredentialRoot(newRevokedRoot: string) {
    return this.credentials.proposeRevokedSecretRoot(newRevokedRoot);
  }

  /**
   * Accepts a pending revoked-secret root after the 2-day timelock.
   * Thin facade over CredentialModule.acceptRevokedSecretRoot.
   * @returns The mined transaction result.
   * @throws TimelockNotReady when the delay has not elapsed.
   * Maps to: contract CredentialRegistry.acceptRevokedSecretRoot; event RevokedSecretRootUpdated.
   * Security: registry-owner only.
   */
  async acceptRevokedCredentialRoot() {
    return this.credentials.acceptRevokedSecretRoot();
  }

  /**
   * Checks whether a credential nullifier has already been spent.
   * NOTE: despite the name this does not verify a credential — it only reports nullifier reuse. A fresh nullifier returns false, which means "not yet spent", not "valid credential".
   * @returns True when the nullifier is already used, false otherwise.
   * Maps to: contract CredentialRegistry.isNullifierUsed; MCP tool agentix_cred_verify.
   */
  async verifyCredential(nullifier: string): Promise<boolean> {
    return this.credentials.isNullifierUsed(nullifier);
  }

  /**
   * Creates a lightweight session (daily caps + allowed targets, owner-signature authorized).
   * Thin facade over SessionModule.createLightweight.
   * @returns The mined transaction result.
   * @throws ValidationError on a bad key, zero id, or past expiry; InvalidOwnerSignature on a bad signature.
   * Maps to: contract SessionManager.createLightweightSession; event LightSessionCreated.
   */
  async createLightweightSession(params: import('./types').CreateLightSessionParams) {
    return this.sessions.createLightweight(params);
  }

  /**
   * Creates a ZK-proof-gated standard session.
   * Thin facade over SessionModule.createStandard — the proof is the entire authorization.
   * @returns The mined transaction result.
   * @throws ValidationError on bad inputs; InvalidProof when the Groth16 proof fails.
   * Maps to: contract SessionManager.createSession; event SessionCreated.
   */
  async createStandardSession(params: import('./types').CreateStandardSessionParams) {
    return this.sessions.createStandard(params);
  }

  /**
   * Revokes a standard session immediately and permanently.
   * Thin facade over SessionModule.revoke (standard sessions only — lightweight sessions need revokeLightweight on the module).
   * @returns The mined transaction result.
   * @throws When the caller is not authorized to revoke this session.
   * Maps to: contract SessionManager.revokeSession; event SessionRevoked.
   */
  async revokeSession(sessionId: string, wallet: string) {
    return this.sessions.revoke(sessionId, wallet);
  }

  /**
   * Reads an organization's credential anchor state (roots, epoch, visibility).
   * NOTE: despite the name this performs no verification — it only returns the anchor's current state for the caller to judge.
   * @returns The CredentialAnchorInfo for the anchor.
   * @throws When the address is not an anchor contract.
   * Maps to: contract OrganizationCredentialAnchor; MCP tool agentix_org_get_anchor.
   */
  async organizationVerify(anchorAddress: string) {
    return this.organizations.getAnchorInfo(anchorAddress);
  }
}
