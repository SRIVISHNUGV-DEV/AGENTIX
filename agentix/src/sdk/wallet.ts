import { ethers, Contract } from 'ethers';
import { ExecuteRequest, BatchExecuteRequest, WalletInfo, TransactionResult } from './types';
import { assertAddress, assertArrayLength } from './utils';
import { ContractRegistry } from './contracts';
import { TransactionManager, TxOptions } from './transaction';
import { Database } from './database';

export class WalletModule {
  /**
   * Wires the wallet module to the contract registry, transaction sender, and local cache.
   * @returns A WalletModule ready to use; no chain calls happen here.
   * Maps to: internal — AgentIX constructor.
   */
  constructor(
    private readonly contracts: ContractRegistry,
    private readonly tx: TransactionManager,
    private readonly db: Database,
  ) {}

  /**
   * Deploys a new AgentWallet for an owner via the factory and returns its address.
   * The wallet address is recovered from the mined WalletCreated event, so the call only succeeds after confirmation.
   * @param salt - Optional bytes32 for a deterministic (CREATE2) address; omit for a random salt.
   * @returns The deployed wallet's address, owner, and configured session-manager/entry-point addresses.
   * @throws When the factory call reverts, or when the creation event cannot be found in the receipt.
   * Maps to: contract AgentWalletFactory.createWallet; CLI 'agentix wallet' create; MCP tool agentix_wallet_create.
   * Side effects: deploys a contract on-chain (gas); caches the wallet locally.
   * Security: the caller must be the future owner or a deployer the owner trusts — ownership is set at creation.
   */
  async create(owner: string, salt?: string): Promise<WalletInfo> {
    assertAddress(owner, 'owner');

    const factory = this.contracts.send('AgentWalletFactory');
    const method = salt
      ? () => factory.createWallet(owner, salt)
      : () => factory.createWallet(owner);

    const result = await this.tx.send(method, { description: 'Create wallet for ' + owner });

    // TransactionManager._parseEvents stores the raw topic hash as eventName,
    // never the decoded event name — match the WalletCreated signature hash
    // instead (same approach as blockchain/adapter extractWalletAddressFromLogs).
    const walletCreatedTopic = ethers.id('WalletCreated(address,address,bytes32,address)');
    const walletCreated = result.events.find(e => e.eventName === walletCreatedTopic);
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

  /**
   * Reads a wallet's owner, session manager, and entry point from chain and refreshes the local cache.
   * Use to confirm what a deployed wallet actually points at, rather than trusting config.
   * @returns The on-chain WalletInfo.
   * @throws When the address is not a deployed AgentWallet (the view calls revert or return garbage).
   * Maps to: contract AgentWallet.owner / sessionManager / entryPoint; MCP tool agentix_wallet_get.
   * Side effects: overwrites the cached wallet record.
   */
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

  /**
   * Executes one call from a wallet (target, ETH value, calldata) as the wallet itself.
   * The wallet, not the signer, is msg.sender on-chain — the signer must be the wallet owner or an authorized session key.
   * @param req - Target address, value in wei, and hex calldata; value is spent from the wallet's balance.
   * @returns The mined transaction result with receipt and events.
   * @throws When the caller is not authorized (NotOwner / session validation failure) or the inner call reverts.
   * Maps to: contract AgentWallet.execute; MCP tool agentix_wallet_execute; CLI 'agentix wallet' execute.
   * Side effects: moves ETH and calls an arbitrary contract — value transfer.
   * Security: `target` and `data` are fully caller-controlled; only call with a target the wallet's session/policy allows.
   */
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

  /**
   * Executes up to 20 calls from a wallet in a single transaction.
   * Cheaper than separate executes, but one failing call reverts the whole batch.
   * @param req - Parallel targets/values/data arrays; all three must have equal length and 1-20 entries.
   * @returns The mined transaction result with receipt and events.
   * @throws ValidationError when the batch is empty or over 20 calls; contract errors when any inner call reverts.
   * Maps to: contract AgentWallet.executeBatch.
   * Side effects: moves ETH and calls arbitrary contracts — value transfer; atomic (all or nothing).
   * Security: same caller-controlled target/data warning as execute, times the batch size.
   */
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

  /**
   * Returns a wallet's native ETH balance in wei.
   * This is spendable ETH, not the EntryPoint deposit — check getDeposit for bundler gas readiness.
   * @returns The balance in wei; 0n for an unfunded wallet.
   * Maps to: internal — MCP tool agentix_wallet_balance.
   */
  async getBalance(address: string): Promise<bigint> {
    assertAddress(address, 'wallet');
    return await this.contracts.provider.getBalance(address);
  }

  /**
   * Returns a wallet's EntryPoint deposit in wei — the balance the ERC-4337 bundler draws gas from.
   * A zero deposit means bundler-submitted UserOps will fail even when the wallet holds ETH.
   * @returns The deposit in wei; 0n when nothing is deposited.
   * Maps to: contract AgentWallet.getDeposit; MCP tool agentix_wallet_balance.
   */
  async getDeposit(address: string): Promise<bigint> {
    assertAddress(address, 'wallet');
    const wallet = this.contracts.get('AgentWallet', address);
    return await wallet.getDeposit();
  }

  /**
   * Tops up a wallet's EntryPoint deposit by sending ETH with the call.
   * Fund this before submitting bundler UserOps, or they revert for lack of gas deposit.
   * @param amount - Wei to deposit, sent as msg.value with the transaction.
   * @returns The mined transaction result.
   * @throws When the signer cannot fund the value or the wallet call reverts.
   * Maps to: contract AgentWallet.addDeposit; CLI 'agentix wallet' deposit.
   * Side effects: moves ETH from the signer into the EntryPoint deposit — value transfer.
   */
  async addDeposit(walletAddress: string, amount: bigint, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(walletAddress, 'wallet');
    const wallet = this.contracts.send('AgentWallet', walletAddress);
    return this.tx.send(
      () => wallet.addDeposit({ value: amount }),
      { description: 'Add deposit ' + ethers.formatEther(amount) + ' ETH', ...options }
    );
  }

  /**
   * Starts a wallet ownership transfer to a new owner (two-step: the new owner must still accept).
   * Ownership does NOT move until acceptOwnership is called by the new owner — report this as "transfer started", never "transferred".
   * @returns The mined transaction result.
   * @throws When the caller is not the current owner.
   * Maps to: contract AgentWallet.changeOwner; event OwnershipTransferStarted.
   * Side effects: opens a pending ownership transfer on-chain.
   * Security: owner-only; a wrong newOwner address strands the wallet until the transfer is re-issued.
   */
  async changeOwner(walletAddress: string, newOwner: string, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(walletAddress, 'wallet');
    assertAddress(newOwner, 'newOwner');
    const wallet = this.contracts.send('AgentWallet', walletAddress);
    return this.tx.send(
      () => wallet.changeOwner(newOwner),
      { description: 'Change owner to ' + newOwner, ...options }
    );
  }

  /**
   * Completes a pending ownership transfer; only the designated new owner can call it.
   * The second half of changeOwner — without this the wallet keeps its old owner.
   * @returns The mined transaction result.
   * @throws When there is no pending transfer for the signer, or the signer is not the designated new owner.
   * Maps to: contract AgentWallet.acceptOwnership; event OwnerChanged.
   * Security: caller must be the new owner; anyone else's call reverts.
   */
  async acceptOwnership(walletAddress: string, options?: TxOptions): Promise<TransactionResult> {
    assertAddress(walletAddress, 'wallet');
    const wallet = this.contracts.send('AgentWallet', walletAddress);
    return this.tx.send(
      () => wallet.acceptOwnership(),
      { description: 'Accept wallet ownership', ...options }
    );
  }
}
