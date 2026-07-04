import { ethers, Contract } from 'ethers';
import { ExecuteRequest, BatchExecuteRequest, WalletInfo, TransactionResult } from './types.js';
import { assertAddress, assertArrayLength } from './utils.js';
import { ContractRegistry } from './contracts.js';
import { TransactionManager, TxOptions } from './transaction.js';
import { Database } from './database.js';

export class WalletModule {
  constructor(
    private readonly contracts: ContractRegistry,
    private readonly tx: TransactionManager,
    private readonly db: Database,
  ) {}

  async create(owner: string, salt?: string): Promise<WalletInfo> {
    assertAddress(owner, 'owner');

    const factory = this.contracts.send('AgentWalletFactory');
    const method = salt
      ? () => factory.createWallet(owner, salt)
      : () => factory.createWallet(owner);

    const result = await this.tx.send(method, { description: 'Create wallet for ' + owner });

    const walletCreated = result.events.find(e => e.eventName && e.eventName.includes('WalletCreated'));
    const wcArgs: any = walletCreated?.args;
    const wcTopics: string[] = wcArgs?.topics || [];
    const walletAddress = wcTopics[1]
      ? ethers.getAddress('0x' + wcTopics[1].slice(26))
      : '';

    if (!walletAddress) {
      throw new Error('Could not determine wallet address from creation event');
    }

    const info: WalletInfo = {
      address: walletAddress,
      owner,
      sessionManager: this.contracts.config.sessionManagerAddress,
      entryPoint: this.contracts.config.entryPointAddress,
    };

    this.db.saveWallet(info);
    return info;
  }

  async getInfo(address: string): Promise<WalletInfo> {
    assertAddress(address, 'wallet');
    const wallet = this.contracts.get('AgentWallet', address);
    const [owner, sessionManager, entryPoint] = await Promise.all([
      wallet.owner(),
      wallet.sessionManager(),
      wallet.entryPoint(),
    ]);
    const info: WalletInfo = { address, owner, sessionManager, entryPoint };
    this.db.saveWallet(info);
    return info;
  }

  async execute(
    walletAddress: string,
    req: ExecuteRequest,
    options?: TxOptions
  ): Promise<TransactionResult> {
    assertAddress(walletAddress, 'wallet');
    assertAddress(req.target, 'target');
    const wallet = this.contracts.send('AgentWallet', walletAddress);
    return this.tx.send(
      () => wallet.execute(req.target, req.value, req.data),
      { description: 'Execute on ' + req.target, ...options }
    );
  }

  async executeBatch(
    walletAddress: string,
    req: BatchExecuteRequest,
    options?: TxOptions
  ): Promise<TransactionResult> {
    assertAddress(walletAddress, 'wallet');
    assertArrayLength(req.targets, 1, 20, 'batch targets');
    const wallet = this.contracts.send('AgentWallet', walletAddress);
    return this.tx.send(
      () => wallet.executeBatch(req.targets, req.values, req.data),
      { description: 'Batch execute (' + req.targets.length + ' calls)', ...options }
    );
  }

  async getBalance(address: string): Promise<bigint> {
    assertAddress(address, 'wallet');
    return await this.contracts.provider.getBalance(address);
  }

  async getDeposit(address: string): Promise<bigint> {
    assertAddress(address, 'wallet');
    const wallet = this.contracts.get('AgentWallet', address);
    return await wallet.getDeposit();
  }

  async addDeposit(walletAddress: string, amount: bigint, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(walletAddress, 'wallet');
    const wallet = this.contracts.send('AgentWallet', walletAddress);
    return this.tx.send(
      () => wallet.addDeposit({ value: amount }),
      { description: 'Add deposit ' + ethers.formatEther(amount) + ' ETH', ...options }
    );
  }

  async changeOwner(walletAddress: string, newOwner: string, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(walletAddress, 'wallet');
    assertAddress(newOwner, 'newOwner');
    const wallet = this.contracts.send('AgentWallet', walletAddress);
    return this.tx.send(
      () => wallet.changeOwner(newOwner),
      { description: 'Change owner to ' + newOwner, ...options }
    );
  }

  async acceptOwnership(walletAddress: string, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(walletAddress, 'wallet');
    const wallet = this.contracts.send('AgentWallet', walletAddress);
    return this.tx.send(
      () => wallet.acceptOwnership(),
      { description: 'Accept wallet ownership', ...options }
    );
  }
}
