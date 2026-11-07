import { ethers } from "ethers";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getProvider, getSigner } from "../core/provider";
import { getProxyGuard } from "../core/proxy-guard";
import { logger } from "../core/logger";

/**
 * ABI source of truth for the RUNTIME: this directory (agentix/src/contracts/abis/).
 * It is a vendored snapshot of contracts/abis/, which is itself generated from
 * Hardhat artifacts by contracts/scripts/extract-abis.js. The two trees'
 * 17 contract/interface ABI JSONs were verified byte-identical (only the
 * MANIFEST.json files differ, and MANIFEST is stale in contracts/ and is
 * never read by this loader — do not use it as an inventory).
 *
 * Why the runtime does NOT read contracts/abis/ directly: the shipped node
 * entry point runs from agentix/dist/ (see package.json build:cli), where
 * ../../contracts/abis does not exist, and the published bundle does not
 * ship the contracts/ tree. Re-vendor this copy whenever contracts are
 * recompiled; do not hand-edit ABIs here.
 */
const ABI_DIR = join(__dirname, "abis");

/**
 * Reads one vendored ABI JSON from agentix/src/contracts/abis/ and parses it.
 * The runtime reads this vendored copy, not contracts/abis/ directly: the shipped entry point runs from dist/, where the contracts tree does not exist. Re-vendor on recompile; never hand-edit ABIs here.
 * @param name - Contract or interface name (without .json).
 * @returns The parsed ABI array.
 * @throws When the file is missing or its JSON is malformed.
 * Maps to: internal — getAbi (cached loader).
 * Side effects: disk read.
 */
function loadAbi(name: string): any[] {
  const p = join(ABI_DIR, `${name}.json`);
  if (!existsSync(p)) throw new Error(`ABI not found: ${name}`);
  return JSON.parse(readFileSync(p, "utf-8"));
}

const KNOWN_ABIS = [
  "CredentialRegistry",
  "SessionManager",
  "AgentWalletFactory",
  "AgentWallet",
  "CapabilityRegistry",
  "DelegationManager",
  "OrganizationRegistry",
  "OrganizationCredentialAnchor",
  "Groth16Verifier",
  "AgentIdentity",
  "IAgentWallet",
  "ICredentialRegistry",
  "ISessionManager",
  "IVerifier",
  "IEntryPoint",
  "IAgentWalletFactory",
  "IAgentIdentity",
];

const abiCache: Map<string, any[]> = new Map();

/**
 * Returns a cached ABI, loading it from disk on first use.
 * The cache is process-global and never invalidated — a re-vendored ABI mid-process is not picked up until restart.
 * @returns The ABI array (the same object on repeat calls — callers must not mutate it).
 * @throws When the ABI file is missing or malformed (via loadAbi).
 * Maps to: internal — getContract, getContractAt, and getAbiByName.
 */
function getAbi(name: string): any[] {
  if (abiCache.has(name)) return abiCache.get(name)!;
  const abi = loadAbi(name);
  abiCache.set(name, abi);
  return abi;
}

/**
 * Returns a contract instance at its configured proxy address, validated by the proxy guard.
 * The address comes from the proxy guard's registry, not config — a proxy the guard does not know is refused.
 * @param asSigner - True (default) connects the signer for writes; false connects the read-only provider.
 * @returns The ethers Contract.
 * @throws When the proxy guard rejects the address, or no signer is configured and asSigner is true.
 * Maps to: contract — the named contract's functions (proxy address).
 * Security: the proxy-guard validation is the only thing standing between a misconfigured address and a call to an arbitrary contract.
 */
export function getContract(name: string, asSigner = true): ethers.Contract {
  const guard = getProxyGuard();
  const address = guard.getProxyAddress(name);
  const validation = guard.validate(address, name);
  if (!validation.valid) throw new Error(validation.error);

  const signerOrProvider = asSigner ? getSigner() : getProvider();
  const abi = getAbi(name);
  return new ethers.Contract(address, abi, signerOrProvider);
}

/**
 * Returns a contract instance at an explicit address, validated by the proxy guard for the named contract.
 * Use for per-instance contracts (a specific wallet or anchor) where the address is not the shared proxy.
 * @param asSigner - True (default) connects the signer for writes; false connects the read-only provider.
 * @returns The ethers Contract at the given address.
 * @throws When the proxy guard rejects the address for this contract name.
 * Maps to: contract — the named contract's functions at the given address.
 * Security: the address is caller-supplied — the guard validates the shape, not that the address is the "right" instance.
 */
export function getContractAt(name: string, address: string, asSigner = true): ethers.Contract {
  const guard = getProxyGuard();
  const validation = guard.validate(address, name);
  if (!validation.valid) throw new Error(validation.error);

  const signerOrProvider = asSigner ? getSigner() : getProvider();
  const abi = getAbi(name);
  return new ethers.Contract(address, abi, signerOrProvider);
}

/**
 * Returns a read-only contract instance at its configured proxy address.
 * Shorthand for getContract(name, false); writes attempted on the result throw at call time.
 * @returns The provider-bound ethers Contract.
 * @throws When the proxy guard rejects the address.
 * Maps to: contract — the named contract's view functions.
 */
export function getReadonlyContract(name: string): ethers.Contract {
  return getContract(name, false);
}

/**
 * Returns the cached ABI for a contract or interface by name.
 * The public name for getAbi, used by encoders that build raw calldata.
 * @returns The ABI array (shared cached object — do not mutate).
 * @throws When the ABI file is missing or malformed.
 * Maps to: internal — blockchain adapter encode* functions.
 */
export function getAbiByName(name: string): any[] {
  return getAbi(name);
}

/**
 * Lists every known proxy contract address from the proxy guard.
 * @returns A name -> address map; empty when the guard knows none.
 * Maps to: MCP tool agentix_contracts; CLI 'agentix contracts'.
 */
export function listContractAddresses(): Record<string, string> {
  const guard = getProxyGuard();
  return guard.listAllProxies();
}

/**
 * Returns the AgentWallet contract instance for one specific wallet address.
 * Shorthand for getContractAt('AgentWallet', walletAddress, asSigner).
 * @param asSigner - True (default) connects the signer for writes; false connects the read-only provider.
 * @returns The ethers Contract at the wallet address.
 * @throws When the proxy guard rejects the address.
 * Maps to: contract AgentWallet at the given wallet address.
 */
export function getWalletContract(walletAddress: string, asSigner = true): ethers.Contract {
  return getContractAt("AgentWallet", walletAddress, asSigner);
}

export { loadAbi, KNOWN_ABIS };
