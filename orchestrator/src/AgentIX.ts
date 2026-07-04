import { Signer } from 'ethers';
import { AgentIXConfig } from './types.js';
import { SignerRequiredError } from './errors.js';
import { loadConfig } from './config.js';
import { ContractRegistry } from './contracts.js';
import { Database } from './database.js';
import { TransactionManager } from './transaction.js';
import { WalletModule } from './wallet.js';
import { IdentityModule } from './identity.js';
import { SessionModule } from './session.js';
import { CredentialModule } from './credential.js';
import { OrganizationModule } from './organization.js';
import { CapabilityModule } from './capability.js';
import { DelegationModule } from './delegation.js';
import { EventIndexer } from './events.js';
import { OwnerModule } from './onlyOwner/index.js';

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
   *
   * @param configOrOverrides - Contract addresses and RPC configuration.
   * @param signer - An ethers Signer from the user's wallet provider.
   *   AgentIX NEVER asks for or stores private keys. Pass a Signer
   *   (ethers.Wallet, JsonRpcSigner from MetaMask, hardware wallet, etc.)
   *   and the SDK will ask it to sign transactions with clear descriptions.
   *   If omitted, only read operations are available.
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

  /** Returns the connected signer's address. Throws if no signer is set. */
  async getSignerAddress(): Promise<string> {
    return this.contracts.getSignerAddressAsync();
  }

  /** Returns the configured chain ID. */
  getChainId(): number {
    return this.config.chainId;
  }

  /** Returns the SDK version. */
  getVersion(): string {
    return '1.0.0';
  }

  /** Checks whether a signer (wallet provider) is available. */
  hasSigner(): boolean {
    return this.contracts.hasSigner();
  }

  // ── High-Level Agent Operations ──

  /** Creates a new AgentWallet for the given owner. Requires a signer. */
  async createWallet(owner: string) {
    return this.wallet.create(owner);
  }

  /** Creates a wallet + fetches its identity record. */
  async createIdentity(owner: string) {
    const walletInfo = await this.wallet.create(owner);
    const identityInfo = await this.identity.getByWallet(walletInfo.address);
    return { wallet: walletInfo, identity: identityInfo };
  }

  /** Executes a single call through an AgentWallet. */
  async execute(wallet: string, target: string, value: bigint, data: string) {
    return this.wallet.execute(wallet, { target, value, data });
  }

  /** Executes a batch of calls through an AgentWallet. */
  async executeBatch(wallet: string, targets: string[], values: bigint[], data: string[]) {
    return this.wallet.executeBatch(wallet, { targets, values, data });
  }

  /** Initiates ownership transfer of a wallet to a new address. */
  async transferWalletOwnership(wallet: string, newOwner: string) {
    return this.wallet.changeOwner(wallet, newOwner);
  }

  /** Publishes a new active credential Merkle root. Requires issuer role. */
  async issueCredential(newRoot: string) {
    return this.credentials.updateActiveRoot(newRoot);
  }

  /** Publishes a revoked secret root. */
  async revokeCredential(newRevokedRoot: string) {
    return this.credentials.updateRevokedSecretRoot(newRevokedRoot);
  }

  /** Rotates the active credential root (alias for issueCredential). */
  async rotateCredentialRoot(newRoot: string) {
    return this.credentials.updateActiveRoot(newRoot);
  }

  /** Checks if a nullifier has been used (credential spent). */
  async verifyCredential(nullifier: string): Promise<boolean> {
    return this.credentials.isNullifierUsed(nullifier);
  }

  /** Creates a lightweight (owner-signed) session. */
  async createLightweightSession(params: import('./types.js').CreateLightSessionParams) {
    return this.sessions.createLightweight(params);
  }

  /** Creates a ZK-proof-based standard session. */
  async createStandardSession(params: import('./types.js').CreateStandardSessionParams) {
    return this.sessions.createStandard(params);
  }

  /** Revokes a session. */
  async revokeSession(sessionId: string, wallet: string) {
    return this.sessions.revoke(sessionId, wallet);
  }

  /** Fetches the credential anchor info for verification. */
  async organizationVerify(anchorAddress: string) {
    return this.organizations.getAnchorInfo(anchorAddress);
  }
}
