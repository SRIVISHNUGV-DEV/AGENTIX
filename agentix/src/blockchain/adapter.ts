import { ethers } from "ethers";
import { getProvider, getSigner } from "../core/provider";
import { getAbiByName, getContract, getReadonlyContract } from "../contracts";
import { getProxyGuard } from "../core/proxy-guard";
import { loadConfig } from "../core/config";
import { logger } from "../core/logger";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      if (attempt === MAX_RETRIES) throw e;
      logger.warn("blockchain", `${label} attempt ${attempt} failed: ${e.message}, retrying...`);
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
  }
  throw new Error("unreachable");
}

// ── Read Operations ───────────────────────────────────────────────

export interface OracleState {
  activeRoot: string;
  revokedRoot: string;
  paused: boolean;
  blockNumber: number;
  blockTimestamp: number;
  chainId: string;
}

export async function readOracleState(): Promise<OracleState> {
  return withRetry(async () => {
    const provider = getProvider();
    const blockNumber = await provider.getBlockNumber();
    const block = await provider.getBlock(blockNumber);
    const timestamp = block?.timestamp || Math.floor(Date.now() / 1000);

    const credReg = getReadonlyContract("CredentialRegistry");
    const [activeRoot, revokedRoot, paused] = await Promise.all([
      credReg.activeRoot().catch(() => "0x" + "0".repeat(64)),
      credReg.revokedSecretRoot().catch(() => "0x" + "0".repeat(64)),
      credReg.paused().catch(() => false),
    ]);

    return {
      activeRoot,
      revokedRoot,
      paused,
      blockNumber,
      blockTimestamp: Number(timestamp),
      chainId: (await provider.getNetwork()).chainId.toString(),
    };
  }, "readOracleState");
}

export async function readWalletOwner(walletAddress: string): Promise<string> {
  const wallet = getReadonlyContract("AgentWallet");
  const iface = new ethers.Interface(["function owner() view returns (address)"]);
  const calldata = iface.encodeFunctionData("owner");
  const provider = getProvider();
  const result = await provider.call({ to: walletAddress, data: calldata });
  return iface.decodeFunctionResult("owner", result)[0] as string;
}

export async function readEntryPointDeposit(walletAddress: string): Promise<bigint> {
  const config = loadConfig();
  const provider = getProvider();
  const iface = new ethers.Interface(["function balanceOf(address) view returns (uint256)"]);
  const calldata = iface.encodeFunctionData("balanceOf", [walletAddress]);
  const result = await provider.call({ to: config.contracts.entryPoint, data: calldata });
  return BigInt(iface.decodeFunctionResult("balanceOf", result)[0].toString());
}

export async function readWalletBalance(walletAddress: string): Promise<bigint> {
  const provider = getProvider();
  return provider.getBalance(walletAddress);
}

// ── Encode Operations (calldata preparation, no chain write) ──────

export interface EncodedTx {
  to: string;
  data: string;
  value: string;
  chainId: number;
}

export function encodeCreateWallet(ownerAddress: string): EncodedTx & { salt: string } {
  const config = loadConfig();
  const guard = getProxyGuard();
  const salt = ethers.hexlify(ethers.randomBytes(32));
  const abi = getAbiByName("AgentWalletFactory");
  const iface = new ethers.Interface(abi);
  const calldata = iface.encodeFunctionData("createWallet(address,bytes32)", [ownerAddress, salt]);
  return {
    to: guard.getProxyAddress("AgentWalletFactory"),
    data: calldata,
    value: "0x0",
    chainId: config.chainId,
    salt,
  };
}

export function encodeWalletExecute(walletAddress: string, target: string, valueWei: string, calldata: string): EncodedTx {
  const config = loadConfig();
  const abi = getAbiByName("AgentWallet");
  const iface = new ethers.Interface(abi);
  const data = iface.encodeFunctionData("execute", [target, ethers.parseEther(valueWei || "0"), calldata || "0x"]);
  return {
    to: walletAddress,
    data,
    value: "0x0",
    chainId: config.chainId,
  };
}

export function encodeWhitelistSelector(walletAddress: string, target: string, selector: string, allowed: boolean): EncodedTx {
  const config = loadConfig();
  // Note: AgentWallet v1 does not have setWhiteListedSelector.
  // Whitelisting is handled at the session/contract level, not per-wallet.
  // This function returns a no-op placeholder to avoid breaking the flow.
  const abi = getAbiByName("AgentWallet");
  const iface = new ethers.Interface(abi);
  // Use execute() to call a no-op (target=self, value=0, data=0x)
  const data = iface.encodeFunctionData("execute", [walletAddress, 0, "0x"]);
  return {
    to: walletAddress,
    data,
    value: "0x0",
    chainId: config.chainId,
  };
}

export function encodeWalletDeposit(walletAddress: string, amountEth: string): EncodedTx {
  const config = loadConfig();
  const valueWei = ethers.parseEther(amountEth);
  const abi = getAbiByName("AgentWallet");
  const iface = new ethers.Interface(abi);
  const data = iface.encodeFunctionData("addDeposit");
  return {
    to: walletAddress,
    data,
    value: ethers.toBeHex(valueWei),
    chainId: config.chainId,
  };
}

export function encodeEntryPointDeposit(walletAddress: string, amountEth: string): EncodedTx {
  const config = loadConfig();
  const valueWei = ethers.parseEther(amountEth || "0.01");
  const abi = getAbiByName("IEntryPoint");
  const iface = new ethers.Interface(abi);
  const data = iface.encodeFunctionData("depositTo", [walletAddress]);
  return {
    to: config.contracts.entryPoint,
    data,
    value: ethers.toBeHex(valueWei),
    chainId: config.chainId,
  };
}

export function encodeRootUpdate(root: string): EncodedTx {
  const config = loadConfig();
  const guard = getProxyGuard();
  const abi = getAbiByName("CredentialRegistry");
  const iface = new ethers.Interface(abi);
  const data = iface.encodeFunctionData("updateActiveRoot", [root]);
  return {
    to: guard.getProxyAddress("CredentialRegistry"),
    data,
    value: "0x0",
    chainId: config.chainId,
  };
}

export interface LightweightSessionParams {
  walletAddress: string;
  sessionKey: string;
  dailySpendLimitEth: string;
  dailyTxLimit: number;
  expiryDays: number;
  ownerSignature: string;
  sessionId?: string;
  expiry?: number;
  allowedTargets?: string[];
}

export interface EncodedLightweightSession extends EncodedTx {
  sessionId: string;
  expiry: number;
  sessionMgrSelector: string;
  sessionManagerAddress: string;
}

export function encodeLightweightSession(params: LightweightSessionParams): EncodedLightweightSession {
  const config = loadConfig();
  const guard = getProxyGuard();
  // Use provided sessionId/expiry from prepare step, or generate fresh ones
  const sessionId = params.sessionId || ethers.hexlify(ethers.randomBytes(32));
  const expiry = params.expiry || Math.floor(Date.now() / 1000) + params.expiryDays * 86400;
  const dailySpendLimit = ethers.parseEther(params.dailySpendLimitEth || "0.1");

  const smAbi = getAbiByName("SessionManager");
  const smIface = new ethers.Interface(smAbi);
  // createLightweightSession(bytes32 sessionId, address sessionKey, uint256 dailySpendLimit, uint256 dailyTxLimit, uint64 expiry, address[] allowedTargets, bytes ownerSignature)
  const sessionCalldata = smIface.encodeFunctionData("createLightweightSession", [
    sessionId,
    params.sessionKey,
    dailySpendLimit,
    params.dailyTxLimit,
    expiry,
    params.allowedTargets || [],
    params.ownerSignature || "0x",
  ]);

  const walletAbi = getAbiByName("AgentWallet");
  const walletIface = new ethers.Interface(walletAbi);
  const executeCalldata = walletIface.encodeFunctionData("execute", [
    config.contracts.sessionManager,
    0,
    sessionCalldata,
  ]);

  return {
    to: params.walletAddress,
    data: executeCalldata,
    value: "0x0",
    chainId: config.chainId,
    sessionId,
    expiry,
    sessionMgrSelector: smIface.getFunction("createLightweightSession")!.selector,
    sessionManagerAddress: config.contracts.sessionManager,
  };
}

// ── Write Operations (on-chain transactions) ──────────────────────

export async function sendRootUpdate(root: string): Promise<{ txHash: string; blockNumber: number }> {
  return withRetry(async () => {
    const credReg = getContract("CredentialRegistry", true);
    const tx = await credReg.updateActiveRoot(root);
    const receipt = await tx.wait();
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
  }, "sendRootUpdate");
}

export async function isIssuer(address: string): Promise<boolean> {
  const credReg = getReadonlyContract("CredentialRegistry");
  return credReg.issuers(address) as Promise<boolean>;
}

export function getSignerAddress(): string {
  return getSigner().address;
}

// ── Event Parsing ─────────────────────────────────────────────────

export function extractWalletAddressFromLogs(logs: any[], factoryAddress: string): string | null {
  const walletCreatedTopic = ethers.id("WalletCreated(address,address,bytes32,address)");
  for (const log of logs) {
    if (log.topics?.[0] === walletCreatedTopic) {
      return "0x" + log.topics[1].slice(26);
    }
  }
  for (const log of logs) {
    if (log.address?.toLowerCase() === factoryAddress.toLowerCase() && log.topics?.length >= 2) {
      return "0x" + log.topics[1].slice(26);
    }
  }
  return null;
}
