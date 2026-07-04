import { ethers } from "ethers";
import { loadConfig } from "./config";
import { getProxyGuard } from "./proxy-guard";
import { getAbiByName } from "../contracts";
import { logger } from "./logger";

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
  txHash: string
): void {
  const { runExecute } = require("../core/database");
  const now = Math.floor(Date.now() / 1000);

  runExecute(
    "INSERT OR REPLACE INTO wallets (wallet_address, owner_address, entry_point, created_at) VALUES (?, ?, ?, ?)",
    walletAddress,
    ownerAddress,
    "",
    now
  );

  // Record the transaction with the factory as to_address (wallet creation goes through the factory)
  try {
    const factoryAddress = getFactoryAddress();
    runExecute(
      "INSERT INTO transactions (wallet_address, tx_hash, to_address, value, data, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      walletAddress,
      txHash || "",
      factoryAddress,
      "0",
      "0xb20ca818", // createWallet(address,bytes32) selector
      "confirmed",
      now
    );
  } catch (e) {
    logger.warn("tx-builder", `Failed to record transaction: ${(e as Error).message}`);
  }

  // Emit event and persist to DB
  try {
    const { getEventBus } = require("../../packages/core/eventbus");
    const bus = getEventBus();
    bus.emit({
      type: "WalletCreated",
      data: { walletAddress, ownerAddress, txHash },
    });
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
