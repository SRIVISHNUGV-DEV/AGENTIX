import { ethers } from "ethers";
import { loadConfig } from "./config";
import { getProxyGuard } from "./proxy-guard";
import { getAbiByName } from "../contracts";
import { logger } from "./logger";
import { runExecute, runSingle, runQuery } from "./database";
import { getEventBus } from "../../packages/core/eventbus";

export interface PreparedTx {
  to: string;
  data: string;
  value: string;
  chainId: number;
  gasLimit?: string;
}

export interface TxReceipt {
  txHash: string;
  blockNumber: number;
  status: boolean;
  logs: any[];
  events: ParsedEvent[];
}

export interface ParsedEvent {
  name: string;
  args: Record<string, any>;
  address: string;
  topics: string[];
}

const GUARD_MAP: Record<string, string> = {
  AgentWalletFactory: "AgentWalletFactory",
  CredentialRegistry: "CredentialRegistry",
  SessionManager: "SessionManager",
  CapabilityRegistry: "CapabilityRegistry",
  DelegationManager: "DelegationManager",
  OrganizationRegistry: "OrganizationRegistry",
};

/**
 * Returns all known deployed contract addresses (proxies + EntryPoint).
 * Used to validate that outgoing transactions only target our contracts.
 */
export function getAllowedAddresses(): string[] {
  const config = loadConfig();
  const addrs: string[] = [];
  for (const [key, val] of Object.entries(config.contracts)) {
    if (val && typeof val === "string") addrs.push(val.toLowerCase());
  }
  return addrs;
}

/**
 * Validates that a target address is one of our deployed contracts OR a known user wallet.
 * Returns { valid, error } — if invalid, the error explains which contract was expected.
 *
 * Wallet addresses (user-deployed via AgentWalletFactory) are allowed if they exist in the local DB.
 * All other addresses must match a deployed proxy address.
 */
export function validateTargetAddress(target: string): { valid: boolean; error?: string } {
  const lower = target.toLowerCase();
  const allowed = getAllowedAddresses();

  // 1. Check if it's a known deployed contract proxy
  if (allowed.includes(lower)) return { valid: true };

  // 2. Check if it's a known user wallet (in the wallets table)
  try {
    const knownWallets = runQuery("SELECT wallet_address FROM wallets") as any[];
    const isKnownWallet = knownWallets.some((w: any) => w.wallet_address?.toLowerCase() === lower);
    if (isKnownWallet) return { valid: true };
  } catch {
    // DB not ready — fall through to block
  }

  return {
    valid: false,
    error: `BLOCKED: Address ${target} is NOT a known AgentIX contract or registered wallet. Transactions may only target deployed proxies or registered wallets. Allowed contracts: ${allowed.join(", ")}`,
  };
}

export function prepareContractCall(
  contractName: string,
  functionName: string,
  args: any[],
  overrides?: { value?: string }
): PreparedTx {
  const config = loadConfig();
  const guard = getProxyGuard();
  const contractKey = GUARD_MAP[contractName] || contractName;
  const address = guard.getProxyAddress(contractKey);
  const abi = getAbiByName(contractName);
  const iface = new ethers.Interface(abi);

  let data: string;
  const fragment = iface.getFunction(functionName);
  if (fragment && fragment.inputs.length !== args.length) {
    const matching = iface.fragments.filter(
      (f: any) => f.type === "function" && f.name === functionName
    ) as any[];
    const overloaded = matching.find((f: any) => f.inputs.length === args.length);
    if (overloaded) {
      data = iface.encodeFunctionData(overloaded, args);
    } else {
      data = iface.encodeFunctionData(functionName, args);
    }
  } else {
    data = iface.encodeFunctionData(functionName, args);
  }

  return {
    to: address,
    data,
    value: overrides?.value || "0x0",
    chainId: config.chainId,
    gasLimit: "0x4C4B40",
  };
}

export function prepareWalletCall(
  walletAddress: string,
  functionName: string,
  args: any[],
  overrides?: { value?: string }
): PreparedTx {
  const config = loadConfig();
  const guard = getProxyGuard();
  const validation = guard.validate(walletAddress);
  if (!validation.valid) throw new Error(validation.error);
  // Validate the wallet address is known (registered in DB or matches impl)
  const knownWallets = runQuery("SELECT wallet_address FROM wallets") as any[];
  const isKnown = knownWallets.some((w: any) => w.wallet_address.toLowerCase() === walletAddress.toLowerCase());
  if (!isKnown) {
    logger.warn("tx-builder", `Wallet ${walletAddress} not found in local DB — proceeding but flagging`);
  }
  const abi = getAbiByName("AgentWallet");
  const iface = new ethers.Interface(abi);
  const data = iface.encodeFunctionData(functionName, args);

  return {
    to: walletAddress,
    data,
    value: overrides?.value || "0x0",
    chainId: config.chainId,
    gasLimit: "0x4C4B40",
  };
}

export function parseEventsFromReceipt(
  receipt: TxReceipt,
  contractName: string,
  abi?: any[]
): ParsedEvent[] {
  const contractAbi = abi || getAbiByName(contractName);
  const iface = new ethers.Interface(contractAbi);
  const events: ParsedEvent[] = [];

  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      if (parsed) {
        const args: Record<string, any> = {};
        parsed.args.forEach((val: any, key: any) => {
          if (typeof key === "string") args[key] = val.toString();
        });
        events.push({
          name: parsed.name,
          args,
          address: log.address,
          topics: log.topics,
        });
      }
    } catch {}
  }

  return events;
}

export function extractWalletAddressFromLogs(
  logs: any[],
  factoryAddress: string
): string | null {
  const walletCreatedTopic = ethers.id(
    "WalletCreated(address,address,bytes32,address)"
  );

  for (const log of logs) {
    if (log.topics?.[0] === walletCreatedTopic) {
      return "0x" + log.topics[1].slice(26);
    }
  }

  for (const log of logs) {
    if (
      log.address?.toLowerCase() === factoryAddress.toLowerCase() &&
      log.topics?.length >= 2
    ) {
      return "0x" + log.topics[1].slice(26);
    }
  }

  return null;
}

export function recordWalletInDB(
  walletAddress: string,
  ownerAddress: string,
  txHash: string,
  harnessId?: string,
  actualToAddress?: string
): void {
  const now = Math.floor(Date.now() / 1000);

  if (harnessId) {
    const existing = runSingle("SELECT wallet_address FROM wallets WHERE harness_id = ?", harnessId) as any;
    if (existing && existing.wallet_address !== walletAddress) {
      throw new Error(`Harness "${harnessId}" already has a wallet at ${existing.wallet_address}. Unlink it first.`);
    }
  }

  runExecute(
    "INSERT OR REPLACE INTO wallets (wallet_address, owner_address, harness_id, entry_point, created_at) VALUES (?, ?, ?, ?, ?)",
    walletAddress,
    ownerAddress,
    harnessId || null,
    "",
    now
  );

  // Record the transaction — use actual to_address if provided, otherwise factory
  try {
    const toAddr = actualToAddress || getFactoryAddress();
    runExecute(
      "INSERT INTO transactions (wallet_address, tx_hash, to_address, value, data, status, event_name, contract_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      walletAddress,
      txHash || "",
      toAddr,
      "0",
      "0xb20ca818",
      "confirmed",
      "WalletCreated",
      "AgentWalletFactory",
      now
    );
  } catch (e) {
    logger.warn("tx-builder", `Failed to record transaction: ${(e as Error).message}`);
  }

  // Emit event and persist to DB
  try {
    const bus = getEventBus();
    void bus.emit({
      type: "WalletCreated",
      data: { walletAddress, ownerAddress, txHash },
    }).catch(() => {});
    // Persist event to DB
    runExecute(
      "INSERT INTO events (event_type, data, tx_hash, created_at) VALUES (?, ?, ?, ?)",
      "WalletCreated",
      JSON.stringify({ walletAddress, ownerAddress, txHash }),
      txHash || "",
      now
    );
  } catch {}

  logger.info("tx-builder", `Recorded wallet: ${walletAddress} (owner: ${ownerAddress})`);
}

export function getConfig() {
  return loadConfig();
}

export function getFactoryAddress(): string {
  return getProxyGuard().getProxyAddress("AgentWalletFactory");
}
