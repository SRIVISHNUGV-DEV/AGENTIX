import { ethers } from "ethers";
import { getContract, getWalletContract } from "../contracts";
import { getProxyGuard } from "../core/proxy-guard";
import { runExecute, runSingle } from "../core/database";
import { getProvider, getSigner } from "../core/provider";
import { logger } from "../core/logger";

export interface WalletResult {
  success: boolean;
  walletAddress?: string;
  ownerAddress?: string;
  balance?: string;
  depositBalance?: string;
  txHash?: string;
  error?: string;
  details?: any;
}

/**
 * Deploy an AgentWallet via the factory and record it locally.
 * One wallet per harness: when harnessId is given, the call fails if that
 * harness already has a wallet or the owner already has an unlinked wallet
 * (link it from the dashboard instead). The wallet address comes from the
 * WalletCreated event, falling back to the owner's last wallet on-chain.
 * @param ownerAddress - Defaults to the runtime signer's address; @param harnessId - Optional harness binding (e.g. 'claude-code').
 * @returns WalletResult with walletAddress, ownerAddress, balance and txHash; success:false + error when validation fails, the harness rule blocks, or the tx reverts.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: MCP tool agentix_wallet_create / contract AgentWalletFactory.createWallet(address,bytes32) (random 32-byte salt).
 * Side effects: on-chain deployment (gas) + local DB insert (INSERT OR REPLACE).
 * Security: the owner address is ProxyGuard-validated first; the caller must confirm the owner — it becomes the wallet's owner.
 */
export async function createWallet(ownerAddress?: string, harnessId?: string): Promise<WalletResult> {
  try {
    const signer = getSigner();
    const owner = ownerAddress || signer.address;

    const validation = getProxyGuard().validate(owner);
    if (!validation.valid) return { success: false, error: validation.error };

    if (harnessId) {
      const existing = runSingle("SELECT wallet_address FROM wallets WHERE harness_id = ?", harnessId) as any;
      if (existing) {
        return { success: false, error: `Harness "${harnessId}" already has a wallet at ${existing.wallet_address}. Each harness can only have one wallet.` };
      }
      // Also check for unlinked wallets belonging to this owner
      const unlinked = runSingle("SELECT wallet_address FROM wallets WHERE owner_address = ? AND harness_id IS NULL", owner) as any;
      if (unlinked) {
        return { success: false, error: `Owner already has an unlinked wallet at ${unlinked.wallet_address}. Link it to harness "${harnessId}" from the dashboard instead.` };
      }
    }

    const factory = getContract("AgentWalletFactory");
    const salt = ethers.randomBytes(32);

    logger.info("wallet", `Creating wallet for owner ${owner}${harnessId ? ` (harness: ${harnessId})` : ""}`);

    const tx = await factory["createWallet(address,bytes32)"](owner, salt);
    const receipt = await tx.wait();

    const event = receipt.logs?.find((l: any) => {
      try {
        const parsed = factory.interface.parseLog(l);
        return parsed?.name === "WalletCreated";
      } catch { return false; }
    });

    let walletAddress = "";
    if (event) {
      const parsed = factory.interface.parseLog(event);
      walletAddress = parsed?.args?.[0] || parsed?.args?.wallet || "";
    }

    if (!walletAddress) {
      const wallets = await factory.getOwnerWallets(owner);
      if (wallets.length > 0) {
        walletAddress = wallets[wallets.length - 1];
      }
    }

    runExecute(
      "INSERT OR REPLACE INTO wallets (wallet_address, owner_address, harness_id, entry_point, created_at) VALUES (?, ?, ?, ?, ?)",
      walletAddress,
      owner,
      harnessId || null,
      "",
      Math.floor(Date.now() / 1000)
    );

    const provider = getProvider();
    const balance = await provider.getBalance(walletAddress);

    logger.info("wallet", `Wallet created: ${walletAddress}`);

    return {
      success: true,
      walletAddress,
      ownerAddress: owner,
      balance: ethers.formatEther(balance),
      txHash: receipt.hash,
    };
  } catch (e: any) {
    logger.error("wallet", `Failed to create wallet: ${e.message}`);
    return { success: false, error: e.message };
  }
}

/**
 * Live wallet info: owner, session manager, entry point, ETH balance and EntryPoint deposit, read on-chain.
 * Five parallel reads (four contract views + balance) — all must succeed or the
 * whole call returns success:false, so a single failing view hides the rest.
 * @param walletAddress - Wallet to inspect; ProxyGuard-validated first (implementation addresses are rejected).
 * @returns WalletResult with ownerAddress, balance, depositBalance and details {sessionManager, entryPoint}; success:false + error on validation or read failure.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: MCP tool agentix_wallet_get.
 * Side effects: read-only contract + RPC calls.
 */
export async function getWalletInfo(walletAddress: string): Promise<WalletResult> {
  try {
    const validation = getProxyGuard().validate(walletAddress);
    if (!validation.valid) return { success: false, error: validation.error };

    const wallet = getWalletContract(walletAddress, false);
    const provider = getProvider();

    const [owner, sm, ep, balance, deposit] = await Promise.all([
      wallet.owner(),
      wallet.sessionManager(),
      wallet.entryPoint(),
      provider.getBalance(walletAddress),
      wallet.getDeposit(),
    ]);

    return {
      success: true,
      walletAddress,
      ownerAddress: owner,
      balance: ethers.formatEther(balance),
      depositBalance: ethers.formatEther(deposit),
      details: { sessionManager: sm, entryPoint: ep },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Always fails: AgentWallet has NO whitelist feature.
 * setWhiteListedParty does not exist on the contract (verified against the fresh
 * ABI), so this returns an explicit error instead of sending a call that would
 * revert. Authorization lives in SessionManager session allowlists.
 * @param walletAddress - Wallet (echoed); @param partyAddress - Intended address (echoed in details); @param status - Intended flag, default true (echoed in details).
 * @returns Always {success:false, error} explaining the missing feature and pointing at setSessionTargets / allowedTargets.
 * @throws Never throws.
 * Maps to: internal — SessionManager session allowlists (setSessionTargets / allowedTargets at creation).
 * Side effects: none — no contract call is made.
 */
export async function whitelistAddress(
  walletAddress: string,
  partyAddress: string,
  status: boolean = true
): Promise<WalletResult> {
  // AgentWallet has NO whitelist feature: setWhiteListedParty does not
  // exist on the contract (verified against the fresh ABI), and the
  // contract test suite's whitelist tests were deleted for exactly that
  // reason. Fail explicitly instead of sending a call that reverts.
  // Authorization is handled by SessionManager session allowlists.
  return {
    success: false,
    walletAddress,
    error: "AgentWallet does not support whitelisting: no setWhiteListedParty function exists on the contract. Authorization is handled by SessionManager session allowlists (setSessionTargets / allowedTargets at creation).",
    details: { party: partyAddress, whitelisted: status },
  };
}

/**
 * Execute one call through the wallet as its owner.
 * The owner path — this bypasses session limits entirely, so it is the owner's
 * direct execution, not an agent action under a session.
 * @param walletAddress - Wallet to execute from; @param to - Call destination, ProxyGuard-validated first; @param value - ETH as a decimal string; @param data - Calldata, defaults to "0x" (plain transfer).
 * @returns WalletResult with txHash and details {to, value, blockNumber}; success:false + error on validation or revert.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: contract AgentWallet.execute.
 * Side effects: on-chain transaction (gas + value transferred).
 * Security: value transfer with the owner's authority — target and data are executed exactly as passed, with no policy check in this path.
 */
export async function executeTransaction(
  walletAddress: string,
  to: string,
  value: string,
  data: string = "0x"
): Promise<WalletResult> {
  try {
    const validation = getProxyGuard().validate(to);
    if (!validation.valid) return { success: false, error: validation.error };

    const wallet = getWalletContract(walletAddress);
    const valueWei = ethers.parseEther(value);

    logger.info("wallet", `Executing: ${value} ETH to ${to} from ${walletAddress}`);

    const tx = await wallet.execute(to, valueWei, data);
    const receipt = await tx.wait();

    return {
      success: true,
      walletAddress,
      txHash: receipt.hash,
      details: { to, value, blockNumber: receipt.blockNumber },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Execute several calls through the wallet as its owner, atomically on-chain.
 * One transaction for the whole batch — either all calls execute or the batch
 * reverts. There is no local length check: mismatched targets/values/data
 * arrays are caught only by the on-chain revert.
 * @param walletAddress - Wallet to execute from; @param targets - Call destinations, each ProxyGuard-validated first; @param values - ETH per call, as decimal strings.
 * @param dataArrays - Calldata per call; defaults to "0x" for every target when omitted/empty.
 * @returns WalletResult with txHash and details {targets, values, blockNumber}; success:false + error on validation or revert.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: MCP tool agentix_wallet_execute_batch (dashboard-only) / contract AgentWallet.executeBatch.
 * Side effects: on-chain transaction (gas + values transferred).
 * Security: value transfer with the owner's authority — every target/data pair is executed exactly as passed, with no policy check in this path.
 */
export async function executeBatch(
  walletAddress: string,
  targets: string[],
  values: string[],
  dataArrays: string[] = []
): Promise<WalletResult> {
  try {
    for (const target of targets) {
      const validation = getProxyGuard().validate(target);
      if (!validation.valid) return { success: false, error: validation.error };
    }

    const wallet = getWalletContract(walletAddress);
    const weiValues = values.map((v) => ethers.parseEther(v));
    const data = dataArrays.length ? dataArrays : targets.map(() => "0x");

    const tx = await wallet.executeBatch(targets, weiValues, data);
    const receipt = await tx.wait();

    return {
      success: true,
      walletAddress,
      txHash: receipt.hash,
      details: { targets, values, blockNumber: receipt.blockNumber },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Fund a wallet's EntryPoint deposit (gas for sponsored UserOps).
 * Sends ETH with the call — the amount is value, not a contract parameter — and
 * the deposit is what the bundler draws on for the wallet's UserOps.
 * @param walletAddress - Wallet to fund; @param amount - ETH as a decimal string.
 * @returns WalletResult with txHash and the new depositBalance; success:false + error on failure.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: contract AgentWallet.addDeposit.
 * Side effects: on-chain transaction moving `amount` ETH into the EntryPoint deposit; reads the new deposit afterwards.
 * Security: value transfer — verify the wallet address; a deposit to the wrong wallet is only recoverable via withdrawGas by that wallet's owner.
 */
export async function depositGas(
  walletAddress: string,
  amount: string
): Promise<WalletResult> {
  try {
    const wallet = getWalletContract(walletAddress);
    const amountWei = ethers.parseEther(amount);

    const tx = await wallet.addDeposit({ value: amountWei });
    const receipt = await tx.wait();

    const newDeposit = await wallet.getDeposit();

    return {
      success: true,
      walletAddress,
      txHash: receipt.hash,
      depositBalance: ethers.formatEther(newDeposit),
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Withdraw from a wallet's EntryPoint deposit to a recipient.
 * Moves deposit funds out — the reverse of depositGas — and only the wallet's
 * owner path can call it, since it executes through the wallet contract.
 * @param walletAddress - Wallet to withdraw from; @param recipient - Address receiving the ETH; @param amount - ETH as a decimal string.
 * @returns WalletResult with txHash and details {recipient, amount}; success:false + error on failure.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: contract AgentWallet.withdrawDepositTo.
 * Side effects: on-chain transaction moving `amount` ETH from the deposit to the recipient.
 * Security: value transfer out of the wallet — verify the recipient; a wrong address sends the funds away with no recall.
 */
export async function withdrawGas(
  walletAddress: string,
  recipient: string,
  amount: string
): Promise<WalletResult> {
  try {
    const wallet = getWalletContract(walletAddress);
    const amountWei = ethers.parseEther(amount);

    const tx = await wallet.withdrawDepositTo(recipient, amountWei);
    const receipt = await tx.wait();

    return {
      success: true,
      walletAddress,
      txHash: receipt.hash,
      details: { recipient, amount },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
