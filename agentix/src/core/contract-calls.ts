/**
 * contract-calls.ts — Typed contract function calling for all AgentIX contracts.
 *
 * This module extracts function signatures from the ABI files and provides
 * a typed, validated way to call any contract function. Every call goes
 * through ProxyGuard to ensure transactions only target deployed proxy
 * addresses — never implementations.
 *
 * Usage:
 *   import { callContractRead, prepareContractWrite } from "./contract-calls";
 *
 *   // Read (view/pure)
 *   const root = await callContractRead("CredentialRegistry", "activeRoot", []);
 *
 *   // Write (requires signer, returns prepared tx for browser to sign)
 *   const tx = prepareContractWrite("CredentialRegistry", "proposeActiveRoot", [root]);
 *   // NOTE: root changes are propose + accept since the C-5 timelock fix.
 *   // Proposing does NOT change the root; acceptActiveRoot() after the
 *   // 2-day timelock completes it. Never describe a propose as an update.
 */

import { ethers } from "ethers";
import { getAbiByName } from "../contracts";
import { getProxyGuard } from "./proxy-guard";
import { loadConfig } from "./config";
import { getProvider, getSigner } from "./provider";
import { validateTargetAddress } from "./tx-builder";
import { logger } from "./logger";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PreparedContractCall {
  to: string;
  data: string;
  value: string;
  chainId: number;
  functionSignature: string;
  contractName: string;
  functionName: string;
  args: readonly any[];
}

export interface ContractReadResult<T = any> {
  value: T;
  raw: any;
}

// ─── ABI Extraction ──────────────────────────────────────────────────────────

interface FunctionFragment {
  name: string;
  inputs: { name: string; type: string }[];
  outputs: { name: string; type: string }[];
  stateMutability: string;
}

const _interfaceCache = new Map<string, ethers.Interface>();

/**
 * Return the cached ethers Interface for a contract's ABI, building it on first use.
 * ABI parsing is the hot path for every call, so the cache exists to avoid re-parsing per request.
 * @param contractName — the ABI key, e.g. "SessionManager"; unknown names throw from the ABI lookup.
 * @returns The Interface (same object on repeat calls).
 * @throws Throws when no ABI is known for the contract.
 * Maps to: internal — extractFunctions / extractEvents / callContractRead / prepareContractWrite (all ABI work).
 * Side effects: caches the Interface in module memory.
 */
function getInterface(contractName: string): ethers.Interface {
  if (_interfaceCache.has(contractName)) return _interfaceCache.get(contractName)!;
  const abi = getAbiByName(contractName);
  const iface = new ethers.Interface(abi);
  _interfaceCache.set(contractName, iface);
  return iface;
}

/**
 * List every function signature in a contract's ABI.
 * The introspection primitive behind the contract registry and any tooling that must know what a contract can do.
 * @param contractName — the ABI key; unknown names throw from the ABI lookup.
 * @returns One entry per function { name, inputs, outputs, stateMutability }, including overloads.
 * @throws Throws when no ABI is known for the contract.
 * Maps to: internal — getContractRegistry (dashboard Developer page).
 */
export function extractFunctions(contractName: string): FunctionFragment[] {
  const iface = getInterface(contractName);
  return iface.fragments
    .filter((f) => f.type === "function")
    .map((f) => ({
      name: (f as ethers.FunctionFragment).name,
      inputs: (f as ethers.FunctionFragment).inputs.map((i) => ({ name: i.name, type: i.type })),
      outputs: (f as ethers.FunctionFragment).outputs.map((o) => ({ name: o.name, type: o.type })),
      stateMutability: (f as ethers.FunctionFragment).stateMutability,
    }));
}

/**
 * List every event signature in a contract's ABI.
 * The introspection primitive behind the contract registry and event decoding.
 * @param contractName — the ABI key; unknown names throw from the ABI lookup.
 * @returns One entry per event { name, inputs[{ name, type, indexed }] }.
 * @throws Throws when no ABI is known for the contract.
 * Maps to: internal — getContractRegistry (dashboard Developer page).
 */
export function extractEvents(contractName: string): { name: string; inputs: { name: string; type: string; indexed: boolean | null }[] }[] {
  const iface = getInterface(contractName);
  return iface.fragments
    .filter((f) => f.type === "event")
    .map((f) => ({
      name: (f as ethers.EventFragment).name,
      inputs: (f as ethers.EventFragment).inputs.map((i) => ({ name: i.name, type: i.type, indexed: i.indexed ?? false })),
    }));
}

/**
 * Return the 4-byte selector for one contract function.
 * Selectors identify functions in raw calldata (token-move decoding, log matching) without the full ABI.
 * @param contractName — the ABI key; `functionName` — must exist (overloads resolve to the first fragment).
 * @returns The selector hex string, e.g. "0xa9059cbb".
 * @throws Throws when the contract or the function is unknown.
 * Maps to: internal — getContractRegistry (selector column) and calldata decoding.
 */
export function getFunctionSelector(contractName: string, functionName: string): string {
  const iface = getInterface(contractName);
  const frag = iface.getFunction(functionName);
  if (!frag) throw new Error(`Function ${functionName} not found in ${contractName}`);
  return frag.selector;
}

/**
 * Check that a function exists on a contract and the arg count matches (overload-aware).
 * The pre-flight every read/write path runs so an ABI mismatch fails with a message, not an encoding exception.
 * @param args — positional args; the count must match some overload of the function.
 * @returns { valid: true } on a match; otherwise { valid: false, error } naming the mismatch.
 * @throws Never throws — ABI/lookup failures are returned as { valid: false, error }.
 * Maps to: internal — callContractRead / prepareContractWrite / prepareWalletWrite (pre-flight).
 */
export function validateFunctionCall(contractName: string, functionName: string, args: any[]): { valid: boolean; error?: string } {
  try {
    const iface = getInterface(contractName);
    const frag = iface.getFunction(functionName);
    if (!frag) {
      return { valid: false, error: `Function ${functionName} not found in ${contractName} ABI` };
    }
    // Handle overloads — find the variant matching arg count
    if (frag.inputs.length !== args.length) {
      const allFragments = iface.fragments.filter(
        (f) => f.type === "function" && (f as ethers.FunctionFragment).name === functionName
      );
      const matching = allFragments.find(
        (f) => (f as ethers.FunctionFragment).inputs.length === args.length
      );
      if (!matching) {
        return {
          valid: false,
          error: `Function ${functionName} in ${contractName} expects ${frag.inputs.length} args, got ${args.length}`,
        };
      }
    }
    return { valid: true };
  } catch (e: any) {
    return { valid: false, error: e.message };
  }
}

// ─── Contract Address Resolution ─────────────────────────────────────────────

/**
 * Resolve a contract name to its deployed address (proxy, or the fixed address for EntryPoint/verifier).
 * AgentWallet has no single address and throws — use prepareWalletWrite with a per-wallet address instead.
 * @param contractName — "AgentWallet" throws; "EntryPoint"/"IEntryPoint" return the singleton; "Groth16Verifier" returns the standalone address.
 * @returns The deployed address.
 * @throws Throws for AgentWallet and for unconfigured contract names.
 * Maps to: internal — callContractRead / prepareContractWrite (target resolution).
 */
export function getContractAddress(contractName: string): string {
  const guard = getProxyGuard();

  // Special cases: AgentWallet is deployed per-user, not a fixed proxy
  if (contractName === "AgentWallet") {
    throw new Error("AgentWallet address must be provided per-wallet. Use prepareWalletWrite() instead.");
  }

  // EntryPoint is a fixed address (not a proxy)
  const config = loadConfig();
  if (contractName === "IEntryPoint" || contractName === "EntryPoint") {
    return config.contracts.entryPoint;
  }

  // Groth16Verifier is not a proxy (standalone)
  if (contractName === "Groth16Verifier") {
    return config.contracts.groth16Verifier;
  }

  return guard.getProxyAddress(contractName);
}

/**
 * Return every deployed and validated contract address.
 * The one-call address dump for health checks and dashboards; it is just the ProxyGuard proxy list.
 * @returns A map of contract key to proxy address (empty when nothing is configured).
 * @throws Never throws.
 * Maps to: MCP tool agentix_contracts (list all proxy contract addresses).
 */
export function getAllContractAddresses(): Record<string, string> {
  const guard = getProxyGuard();
  return guard.listAllProxies();
}

// ─── Read Operations (view/pure) ─────────────────────────────────────────────

/**
 * Execute a read-only contract call and decode its return value.
 * View/pure functions only in practice: it uses provider.call, so no signer, gas, or transaction is involved.
 * @param contractName — the ABI key; `functionName` — must exist with a matching arg count.
 * @param args — positional ABI args; `overrideAddress` — bypasses config resolution (AgentWallet reads use this).
 * @returns { value, raw } — value is unwrapped for single-return functions, the full Result otherwise.
 * @throws Throws on validation failure, a rejected target address, an RPC failure, or a decode failure.
 * Maps to: contract — <contractName>.<functionName> (read-only eth_call).
 * Side effects: one eth_call RPC request.
 */
export async function callContractRead<T = any>(
  contractName: string,
  functionName: string,
  args: any[],
  overrideAddress?: string
): Promise<ContractReadResult<T>> {
  const validation = validateFunctionCall(contractName, functionName, args);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const iface = getInterface(contractName);
  const data = iface.encodeFunctionData(functionName, args);
  const to = overrideAddress || getContractAddress(contractName);

  // Validate the target address
  const targetCheck = validateTargetAddress(to);
  if (!targetCheck.valid && contractName !== "AgentWallet" && contractName !== "IEntryPoint") {
    throw new Error(`Address validation failed: ${targetCheck.error}`);
  }

  const provider = getProvider();
  const result = await provider.call({ to, data });
  const decoded = iface.decodeFunctionResult(functionName, result);

  // If single return value, unwrap it
  const value = decoded.length === 1 ? decoded[0] : decoded;

  return { value, raw: decoded };
}

// ─── Write Operations (requires signer) ──────────────────────────────────────

/**
 * Build an unsigned transaction for a contract write (calldata + target + chain) — nothing is sent.
 * The browser-signing path: the dashboard signs the returned calldata with the owner's key.
 * @param contractName — the ABI key; `functionName` — must exist with a matching arg count.
 * @param args — positional ABI args (frozen into the result); `overrides.value` — hex value, default 0x0.
 * @returns A PreparedContractCall with the target proxy address and the args frozen.
 * @throws Throws on validation failure, a rejected target address, or ABI encoding failure.
 * Maps to: contract — <contractName>.<functionName> (prepared, unsigned).
 * Security: the target is validated through ProxyGuard — never an implementation address.
 */
export function prepareContractWrite(
  contractName: string,
  functionName: string,
  args: any[],
  overrides?: { value?: string }
): PreparedContractCall {
  const validation = validateFunctionCall(contractName, functionName, args);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const iface = getInterface(contractName);
  const data = iface.encodeFunctionData(functionName, args);
  const to = getContractAddress(contractName);

  // Validate target address is a deployed proxy
  const targetCheck = validateTargetAddress(to);
  if (!targetCheck.valid && contractName !== "AgentWallet" && contractName !== "IEntryPoint") {
    throw new Error(`Address validation failed: ${targetCheck.error}`);
  }

  const config = loadConfig();

  return {
    to,
    data,
    value: overrides?.value || "0x0",
    chainId: config.chainId,
    functionSignature: `${functionName}(${args.length} args)`,
    contractName,
    functionName,
    args: Object.freeze([...args]),
  };
}

/**
 * Build an unsigned transaction against one user's AgentWallet instance.
 * Wallets are per-user deployments, so the address is a parameter — unlike prepareContractWrite, which resolves a proxy.
 * @param walletAddress — the AgentWallet instance; an implementation address is rejected by the guard.
 * @param functionName — the AgentWallet function; `args` — positional ABI args (frozen into the result).
 * @param overrides — optional { value } in hex; defaults to 0x0.
 * @returns A PreparedContractCall to the wallet address.
 * @throws Throws on validation failure, a guard rejection, or ABI encoding failure.
 * Maps to: contract AgentWallet.<functionName> (prepared, unsigned).
 */
export function prepareWalletWrite(
  walletAddress: string,
  functionName: string,
  args: any[],
  overrides?: { value?: string }
): PreparedContractCall {
  const contractName = "AgentWallet";
  const validation = validateFunctionCall(contractName, functionName, args);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const guard = getProxyGuard();
  const walletValidation = guard.validate(walletAddress);
  if (!walletValidation.valid) {
    throw new Error(`Wallet address validation failed: ${walletValidation.error}`);
  }

  const iface = getInterface(contractName);
  const data = iface.encodeFunctionData(functionName, args);
  const config = loadConfig();

  return {
    to: walletAddress,
    data,
    value: overrides?.value || "0x0",
    chainId: config.chainId,
    functionSignature: `${functionName}(${args.length} args)`,
    contractName,
    functionName,
    args: Object.freeze([...args]),
  };
}

// ─── Send Operations (server-side signing) ───────────────────────────────────

/**
 * Send a contract transaction with the server's signer and wait for its receipt.
 * Admin operations only (root updates, issuer management): user wallet operations go through the bundler, not this signer.
 * @param contractName — the ABI key; `functionName` — must exist with a matching arg count.
 * @param args — positional ABI args; `overrides.value` — native value in BigNumberish form.
 * @returns { txHash, blockNumber, status } — status is true only when the receipt status is 1.
 * @throws Throws on preparation failure, a send failure, or a null receipt after mining.
 * Maps to: contract — <contractName>.<functionName> (server-signed send).
 * Side effects: broadcasts a transaction and waits for it to be mined (network I/O).
 * Security: uses the server signer — only call from trusted admin paths, never with user-supplied contract/function names.
 */
export async function sendContractTransaction(
  contractName: string,
  functionName: string,
  args: any[],
  overrides?: { value?: ethers.BigNumberish }
): Promise<{ txHash: string; blockNumber: number; status: boolean }> {
  const prepared = prepareContractWrite(contractName, functionName, args, {
    value: overrides?.value ? ethers.toBeHex(overrides.value) : undefined,
  });

  const signer = getSigner();
  const tx = await signer.sendTransaction({
    to: prepared.to,
    data: prepared.data,
    value: overrides?.value || 0n,
  });

  const receipt = await tx.wait();
  if (!receipt) throw new Error(`Transaction ${tx.hash} was mined but receipt is null`);
  logger.info("contract-calls", `Sent ${contractName}.${functionName}: tx=${receipt.hash} status=${receipt.status}`);

  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    status: receipt.status === 1,
  };
}

// ─── Event Decoding ──────────────────────────────────────────────────────────

/**
 * Decode receipt logs into named events using one contract's ABI.
 * Logs that do not match the ABI are skipped — a receipt may mix contracts, so that is expected, not an error.
 * @param contractName — the ABI key for decoding; `logs` — receipt logs { topics, data, address }.
 * @returns The decoded events in log order; [] when nothing matches.
 * @throws Never throws — per-log parse failures are skipped.
 * Maps to: event — <contractName> events (receipt decoding).
 */
export function decodeEvents(
  contractName: string,
  logs: { topics: string[]; data: string; address: string }[]
): { name: string; args: Record<string, any>; address: string; topics: string[] }[] {
  const iface = getInterface(contractName);
  const events: { name: string; args: Record<string, any>; address: string; topics: string[] }[] = [];

  for (const log of logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as any, data: log.data });
      if (parsed) {
        const args: Record<string, any> = {};
        // Convert args to plain object (ethers v6 returns Result)
        for (const key of Object.keys(parsed.args)) {
          if (isNaN(Number(key))) {
            args[key] = parsed.args[key]?.toString?.() ?? parsed.args[key];
          }
        }
        events.push({
          name: parsed.name,
          args,
          address: log.address,
          topics: log.topics,
        });
      }
    } catch {
      // Log doesn't match this contract's ABI — skip
    }
  }

  return events;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

/**
 * Build the full contract catalogue: every contract with its address, functions, and events.
 * The dashboard Developer page renders this; an unconfigured address shows as "(not configured)" rather than throwing.
 * @returns One entry per contract { name, address, functions[{ name, inputs, outputs, stateMutability, selector }], events }.
 * @throws Never throws — per-contract address failures degrade to "(not configured)".
 * Maps to: dashboard — Developer page contract registry.
 */
export function getContractRegistry() {
  const contracts = [
    "Groth16Verifier",
    "CredentialRegistry",
    "SessionManager",
    "AgentWalletFactory",
    "AgentWallet",
    "CapabilityRegistry",
    "DelegationManager",
    "OrganizationRegistry",
    "OrganizationCredentialAnchor",
    "AgentIdentity",
  ];

  const guard = getProxyGuard();
  const config = loadConfig();

  return contracts.map((name) => {
    let address: string;
    try {
      if (name === "Groth16Verifier") {
        address = config.contracts.groth16Verifier;
      } else if (name === "AgentWallet") {
        address = config.contracts.agentWalletImplementation;
      } else {
        address = guard.getProxyAddress(name);
      }
    } catch {
      address = "(not configured)";
    }

    const functions = extractFunctions(name);
    const events = extractEvents(name);

    return {
      name,
      address,
      functions: functions.map((f) => ({
        name: f.name,
        inputs: f.inputs.map((i) => `${i.type} ${i.name}`).join(", "),
        outputs: f.outputs.map((o) => `${o.type} ${o.name}`).join(", "),
        stateMutability: f.stateMutability,
        selector: getFunctionSelector(name, f.name),
      })),
      events: events.map((e) => ({
        name: e.name,
        inputs: e.inputs.map((i) => `${i.type}${i.indexed ? " indexed" : ""} ${i.name}`).join(", "),
      })),
    };
  });
}
