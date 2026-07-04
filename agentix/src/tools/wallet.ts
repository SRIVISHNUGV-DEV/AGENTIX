import { ethers } from "ethers";
import { getContract, getReadonlyContract, getWalletContract } from "../contracts";
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

export async function createWallet(ownerAddress?: string): Promise<WalletResult> {
  try {
    const signer = getSigner();
    const owner = ownerAddress || signer.address;

    const validation = getProxyGuard().validate(owner);
    if (!validation.valid) return { success: false, error: validation.error };

    const factory = getContract("AgentWalletFactory");
    const salt = ethers.randomBytes(32);

    logger.info("wallet", `Creating wallet for owner ${owner}`);

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
      "INSERT OR REPLACE INTO wallets (wallet_address, owner_address, entry_point, created_at) VALUES (?, ?, ?, ?)",
      walletAddress,
      owner,
      (await getReadonlyContract("SessionManager").walletFactory()) ? "" : "",
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

export async function whitelistAddress(
  walletAddress: string,
  partyAddress: string,
  status: boolean = true
): Promise<WalletResult> {
  try {
    const wallet = getWalletContract(walletAddress);
    logger.info("wallet", `Setting whitelist for ${partyAddress} to ${status} on ${walletAddress}`);

    const tx = await wallet.setWhiteListedParty(partyAddress, status);
    const receipt = await tx.wait();

    return {
      success: true,
      walletAddress,
      txHash: receipt.hash,
      details: { party: partyAddress, whitelisted: status },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

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
