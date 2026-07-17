import { ethers } from "ethers";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getProvider, getSigner } from "../core/provider";
import { getProxyGuard } from "../core/proxy-guard";
import { logger } from "../core/logger";

const ABI_DIR = join(__dirname, "abis");

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

function getAbi(name: string): any[] {
  if (abiCache.has(name)) return abiCache.get(name)!;
  const abi = loadAbi(name);
  abiCache.set(name, abi);
  return abi;
}

export function getContract(name: string, asSigner = true): ethers.Contract {
  const guard = getProxyGuard();
  const address = guard.getProxyAddress(name);
  const validation = guard.validate(address, name);
  if (!validation.valid) throw new Error(validation.error);

  const signerOrProvider = asSigner ? getSigner() : getProvider();
  const abi = getAbi(name);
  return new ethers.Contract(address, abi, signerOrProvider);
}

export function getContractAt(name: string, address: string, asSigner = true): ethers.Contract {
  const guard = getProxyGuard();
  const validation = guard.validate(address, name);
  if (!validation.valid) throw new Error(validation.error);

  const signerOrProvider = asSigner ? getSigner() : getProvider();
  const abi = getAbi(name);
  return new ethers.Contract(address, abi, signerOrProvider);
}

export function getReadonlyContract(name: string): ethers.Contract {
  return getContract(name, false);
}

export function getAbiByName(name: string): any[] {
  return getAbi(name);
}

export function listContractAddresses(): Record<string, string> {
  const guard = getProxyGuard();
  return guard.listAllProxies();
}

export function getWalletContract(walletAddress: string, asSigner = true): ethers.Contract {
  return getContractAt("AgentWallet", walletAddress, asSigner);
}

export { loadAbi, KNOWN_ABIS };
