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
 *   const tx = prepareContractWrite("CredentialRegistry", "updateActiveRoot", [root]);
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

function getInterface(contractName: string): ethers.Interface {
  if (_interfaceCache.has(contractName)) return _interfaceCache.get(contractName)!;
  const abi = getAbiByName(contractName);
  const iface = new ethers.Interface(abi);
  _interfaceCache.set(contractName, iface);
  return iface;
}

/**
 * Extract all function signatures from a contract's ABI.
 * Returns an array of { name, inputs, outputs, stateMutability }.
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
 * Extract all event signatures from a contract's ABI.
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
 * Get the function selector (4-byte) for a contract function.
 */
export function getFunctionSelector(contractName: string, functionName: string): string {
  const iface = getInterface(contractName);
  const frag = iface.getFunction(functionName);
  if (!frag) throw new Error(`Function ${functionName} not found in ${contractName}`);
  return frag.selector;
}

/**
 * Validate that a function exists on a contract and the arg count matches.
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
 * Get the deployed proxy address for a contract name.
 * Always goes through ProxyGuard — never returns implementation addresses.
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
 * Get all deployed and validated contract addresses.
 */
export function getAllContractAddresses(): Record<string, string> {
  const guard = getProxyGuard();
  return guard.listAllProxies();
}

// ─── Read Operations (view/pure) ─────────────────────────────────────────────

/**
 * Call a read-only contract function.
 * Uses the provider (no signer needed).
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
 * Prepare a contract write call (returns calldata for the browser to sign).
 * Does NOT send a transaction — returns the encoded calldata + target address.
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
 * Prepare a wallet-specific write call (for AgentWallet instances).
 * The wallet address is user-specific, so it must be provided.
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
 * Send a contract transaction using the server's signer.
 * Use this for admin operations (root updates, issuer management, etc.)
 * NOT for user wallet operations — those go through the bundler.
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
 * Decode event logs from a transaction receipt using a contract's ABI.
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
 * Get a summary of all contracts, their functions, and addresses.
 * Useful for the dashboard Developer page.
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
