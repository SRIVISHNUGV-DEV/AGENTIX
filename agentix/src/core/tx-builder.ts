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
 * List every address outgoing transactions may target (configured proxies + EntryPoint).
 * The allowlist behind validateTargetAddress: anything not on it (and not a known wallet) is blocked.
 * @returns Lowercased contract addresses from config; [] when nothing is configured (which blocks everything).
 * @throws Never throws — loadConfig itself never throws (it falls back to defaults).
 * Maps to: internal — validateTargetAddress (allowlist source).
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
 * Decide whether a transaction may target an address: a known proxy, or a wallet in the local DB.
 * The send-side allowlist: unknown addresses are blocked with the full allowed list in the error, so misconfiguration is diagnosable.
 * @param target — the address to check; compared lowercased.
 * @returns { valid: true } for proxies and registered wallets; otherwise { valid: false, error } naming the block.
 * @throws Never throws — DB failures fall through to "blocked" instead of crashing the check.
 * Maps to: internal — prepareContractCall / prepareWalletCall / callContractRead (pre-send gate).
 * Security: this is the send-side allowlist — a bypass here means funds can be sent to arbitrary contracts.
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

/**
 * Build an unsigned transaction to a named contract function (calldata + target + chain).
 * Resolves the proxy via ProxyGuard and picks the overload matching the arg count; nothing is signed or sent here.
 * @param contractName — the ABI/config key, e.g. "SessionManager"; unknown names throw from the ABI lookup.
 * @param args — positional ABI args; a count matching no overload still encodes against the first fragment (and may throw).
 * @param overrides — optional { value } in hex; defaults to 0x0.
 * @returns A PreparedTx with a fixed 0x4C4B40 (5,000,000) gas limit.
 * @throws Throws when the contract is unknown, the address cannot be resolved, or ABI encoding fails.
 * Maps to: contract — <contractName>.<functionName> (prepared, unsigned).
 */
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

/**
 * Build an unsigned transaction against one user's AgentWallet instance.
 * The wallet address itself is the target, so it must pass the ProxyGuard check first; an unregistered wallet only warns, it is not blocked.
 * @param walletAddress — the AgentWallet instance; an implementation address is rejected by the guard.
 * @param functionName — the AgentWallet function, e.g. "execute"; unknown functions throw from ABI encoding.
 * @param overrides — optional { value } in hex; defaults to 0x0.
 * @returns A PreparedTx to the wallet with a fixed 0x4C4B40 (5,000,000) gas limit.
 * @throws Throws when the guard rejects the wallet or ABI encoding fails.
 * Maps to: contract AgentWallet.<functionName> (prepared, unsigned).
 * Security: the wallet check is advisory for unknown wallets (warn-only) — the guard rejection is the hard block.
 */
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

/**
 * Decode the logs of a transaction receipt into named events using a contract ABI.
 * Logs that do not match the ABI are skipped silently — a receipt may mix contracts, so that is expected.
 * @param receipt — the mined receipt; only its logs are read.
 * @param contractName — the ABI key, used unless an explicit `abi` is passed.
 * @returns The decoded events in log order; [] when nothing matches.
 * @throws Throws when the ABI cannot be loaded for the contract.
 * Maps to: internal — wallet creation / transaction confirmation flows (receipt decoding).
 */
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

/**
 * Pull the new wallet address out of a factory receipt's logs.
 * Prefers the WalletCreated topic (indexed wallet is topics[1]); falls back to any log from the factory with 2+ topics.
 * @param logs — receipt logs; `factoryAddress` — the AgentWalletFactory address for the fallback match.
 * @returns The wallet address, or null when no log carries it.
 * @throws Never throws — malformed logs simply do not match.
 * Maps to: event WalletCreated (AgentWalletFactory).
 */
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

/**
 * Record a newly created wallet (and its creation transaction) in the local DB and emit the event.
 * One harness id may own only one wallet: re-recording a different wallet for the same harness throws.
 * @param walletAddress — the new AgentWallet; `ownerAddress` — its owner.
 * @param txHash — the creation transaction hash ("" when unknown).
 * @param harnessId — optional harness binding; `actualToAddress` — overrides the recorded to-address (defaults to the factory).
 * @returns Nothing.
 * @throws Throws when the harness already has a different wallet; transaction/event writes failing are logged, not thrown.
 * Maps to: event WalletCreated (emitted on the bus and persisted to the events table).
 * Side effects: upserts wallets, inserts a transactions row and an events row, emits on the event bus.
 */
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

/**
 * Return the current runtime config (thin alias over loadConfig).
 * Kept so callers in this module read config through one local name.
 * @returns The merged config (saved values over defaults).
 * @throws Never throws — a missing/corrupt file returns defaults.
 * Maps to: internal — loadConfig (alias).
 */
export function getConfig() {
  return loadConfig();
}

/**
 * Return the AgentWalletFactory proxy address from config.
 * The factory is the only legitimate creator of wallets, so its address is needed wherever creation is recorded.
 * @returns The factory proxy address.
 * @throws Throws when no proxy address is configured for AgentWalletFactory.
 * Maps to: internal — recordWalletInDB (default to-address for the creation transaction).
 */
export function getFactoryAddress(): string {
  return getProxyGuard().getProxyAddress("AgentWalletFactory");
}
