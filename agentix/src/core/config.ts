import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export const AGENTIX_HOME = process.env.AGENTIX_HOME || join(homedir(), ".agentix");

export interface AgentixConfig {
  version: string;
  chainId: number;
  rpcUrl: string;
  rpcFallbackUrl: string;
  /** Full ordered rotation list (primary + public fallbacks). Optional; when
   *  present the provider rotates through it before giving up. */
  rpcFallbackUrls?: string[];
  networkName: string;
  contracts: {
    groth16Verifier: string;
    credentialRegistry: string;
    sessionManager: string;
    agentWalletFactory: string;
    agentWalletImplementation: string;
    capabilityRegistry: string;
    delegationManager: string;
    organizationRegistry: string;
    organizationCredentialAnchor: string;
    agentIdentity: string;
    entryPoint: string;
  };
  implementations: Record<string, string>;
  database: { path: string };
  backup: { path: string };
  logs: { path: string };
  tools: { registryPath: string };
  x402?: {
    sellerEnabled: boolean;
    sellerAddress: string;
    buyerEnabled: boolean;
    facilitatorUrl: string;
    network: string;
  };
}

const DEFAULT_CONFIG: AgentixConfig = {
  version: "1.0.0",
  chainId: 84532,
  rpcUrl: "https://sepolia.base.org",
  rpcFallbackUrl: "https://base-sepolia-rpc.publicnode.com",
  networkName: "baseSepolia",
  contracts: {
    groth16Verifier: "0x7bA15966B895BEb00B291a73Aa672918D1E27cf9",
    credentialRegistry: "0x3b738E79053eD2993A9c061Dd2A4AA85A9962378",
    sessionManager: "0x1651b88dB25005fB22906D7d28A25c45ef9dc2Bf",
    agentWalletFactory: "0x95613c9cfEca1e77597cf6F54cDCA21a9Be7aA88",
    agentWalletImplementation: "0x206630bC8C366b94d4F73382f9F1742795F49de2",
    capabilityRegistry: "0xDa7069616F793d4048809245AA7Ce3f1C1d3EC0d",
    delegationManager: "0x2F7e35D096b43A002964bB6e343494188ca51D11",
    organizationRegistry: "0x982EAcfF15e6C326F534eB671B009546bae3D13a",
    organizationCredentialAnchor: "0x26d64c5Cad7e434534C9f349Bb14E777AA10E99F",
    agentIdentity: "0x5eb3688D61187550400A940D43461e7984Ca405c",
    entryPoint: "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108",
  },
  implementations: {
    credentialRegistry: "0x3b738E79053eD2993A9c061Dd2A4AA85A9962378",
    sessionManager: "0x1651b88dB25005fB22906D7d28A25c45ef9dc2Bf",
    agentWalletFactory: "0x95613c9cfEca1e77597cf6F54cDCA21a9Be7aA88",
    capabilityRegistry: "0xDa7069616F793d4048809245AA7Ce3f1C1d3EC0d",
    delegationManager: "0x2F7e35D096b43A002964bB6e343494188ca51D11",
    organizationRegistry: "0x982EAcfF15e6C326F534eB671B009546bae3D13a",
  },
  database: { path: join(AGENTIX_HOME, "db", "agentix.db") },
  backup: { path: join(AGENTIX_HOME, "backups") },
  logs: { path: join(AGENTIX_HOME, "logs") },
  tools: { registryPath: join(AGENTIX_HOME, "tools", "registry.json") },
};

const CONFIG_PATH = join(AGENTIX_HOME, "config", "agentix.config.json");

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function loadConfig(): AgentixConfig {
  if (!existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const saved = JSON.parse(raw);
    return {
      ...DEFAULT_CONFIG,
      ...saved,
      contracts: { ...DEFAULT_CONFIG.contracts, ...(saved.contracts || {}) },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: Partial<AgentixConfig>): void {
  const dir = join(AGENTIX_HOME, "config");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const current = loadConfig();
  const merged = { ...current, ...config };
  writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
}

export function ensureDirectories(): void {
  const dirs = [
    "config",
    "contracts",
    "organizations",
    "trees",
    "credentials",
    "sessions",
    "wallets",
    "proofs",
    "capabilities",
    "delegations",
    "logs",
    "db",
    "tools",
    "cache",
    "backups",
  ];
  for (const d of dirs) {
    const p = join(AGENTIX_HOME, d);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }
}

export { DEFAULT_CONFIG };
