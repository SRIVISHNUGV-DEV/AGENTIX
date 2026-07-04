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
   *
   * @param configOrOverrides - Contract addresses and RPC configuration.
   * @param signer - An ethers Signer from the user's wallet provider.
   *   AgentIX NEVER asks for or stores private keys.
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

  async getSignerAddress(): Promise<string> {
    return this.contracts.getSignerAddressAsync();
  }

  getChainId(): number {
    return this.config.chainId;
  }

  getVersion(): string {
    return '1.0.0';
  }

  hasSigner(): boolean {
    return this.contracts.hasSigner();
  }

  async createWallet(owner: string) {
    return this.wallet.create(owner);
  }

  async createIdentity(owner: string) {
    const walletInfo = await this.wallet.create(owner);
    const identityInfo = await this.identity.getByWallet(walletInfo.address);
    return { wallet: walletInfo, identity: identityInfo };
  }

  async execute(wallet: string, target: string, value: bigint, data: string) {
    return this.wallet.execute(wallet, { target, value, data });
  }

  async executeBatch(wallet: string, targets: string[], values: bigint[], data: string[]) {
    return this.wallet.executeBatch(wallet, { targets, values, data });
  }

  async transferWalletOwnership(wallet: string, newOwner: string) {
    return this.wallet.changeOwner(wallet, newOwner);
  }

  async issueCredential(newRoot: string) {
    return this.credentials.updateActiveRoot(newRoot);
  }

  async revokeCredential(newRevokedRoot: string) {
    return this.credentials.updateRevokedSecretRoot(newRevokedRoot);
  }

  async rotateCredentialRoot(newRoot: string) {
    return this.credentials.updateActiveRoot(newRoot);
  }

  async verifyCredential(nullifier: string): Promise<boolean> {
    return this.credentials.isNullifierUsed(nullifier);
  }

  async createLightweightSession(params: import('./types').CreateLightSessionParams) {
    return this.sessions.createLightweight(params);
  }

  async createStandardSession(params: import('./types').CreateStandardSessionParams) {
    return this.sessions.createStandard(params);
  }

  async revokeSession(sessionId: string, wallet: string) {
    return this.sessions.revoke(sessionId, wallet);
  }

  async organizationVerify(anchorAddress: string) {
    return this.organizations.getAnchorInfo(anchorAddress);
  }
}
