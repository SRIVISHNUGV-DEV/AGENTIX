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

/**
 * Canonical contract addresses: contracts/deployments/baseSepolia-84532.json
 * (the deployment record the README calls canonical; the SDK in
 * src/sdk/config.ts already uses this same set). These defaults were
 * reconciled to that set so the runtime, the SDK, and the deployment record
 * no longer disagree out of the box. `entryPoint` is NOT in the deployment
 * JSON; it keeps the canonical EntryPoint singleton address, which the SDK
 * also uses. The deployment JSON is flat — it does not distinguish proxies
 * from implementations — so `implementations` below mirrors `contracts` for
 * the six entries it carries, exactly as before; do not read that mirroring
 * as proof that an address is a proxy or an implementation.
 *
 * LIVE-HEALTH WARNING (verified 2026-10-29 on the public Base Sepolia RPC):
 * BOTH the old defaults and this deployment-JSON set have contracts deployed,
 * verifier bytecode is identical across the two sets, anchor and wallet
 * implementations differ, and all 12 proxy addresses in both sets read an
 * all-zero ERC1967 implementation slot. Neither set is therefore known to be
 * live-healthy: do NOT run a real-contract demo against these addresses.
 * Live on-chain flows need a fresh verified deployment first.
 */
const DEFAULT_CONFIG: AgentixConfig = {
  version: "1.0.0",
  chainId: 84532,
  rpcUrl: "https://sepolia.base.org",
  rpcFallbackUrl: "https://base-sepolia-rpc.publicnode.com",
  networkName: "baseSepolia",
  contracts: {
    groth16Verifier: "0x3056bB17323228d1829D2f6A2a96Af8e079095c2",
    credentialRegistry: "0xF1C30a96aa97faB2A29B2E8Cdc05fc321AA7511E",
    sessionManager: "0x9b7B7d631098f046eaFb4637DC859eBA51e238C0",
    agentWalletFactory: "0x6A4C643f59952CfBfEcEdaf182B3C98D778df2c1",
    agentWalletImplementation: "0x6C826A49aD8447FD94d61f515013ea93066e94C5",
    capabilityRegistry: "0x90D4d0D35709D4e29765F5132DaD0E85Fc07aD6A",
    delegationManager: "0x6Ee3cdeB9c1a1aE83CF0bb0E469B98736Cb07CB5",
    organizationRegistry: "0xdF3e6819fC65966d0D43A3768Aaa40fd50B59443",
    organizationCredentialAnchor: "0x491aD666EFb0E79Ce8406a10914033eEdB6165b6",
    agentIdentity: "0xaF20A4CF58CF8E3DF6bF2545Ed9371d39E97cD71",
    entryPoint: "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108",
  },
  implementations: {
    credentialRegistry: "0xF1C30a96aa97faB2A29B2E8Cdc05fc321AA7511E",
    sessionManager: "0x9b7B7d631098f046eaFb4637DC859eBA51e238C0",
    agentWalletFactory: "0x6A4C643f59952CfBfEcEdaf182B3C98D778df2c1",
    capabilityRegistry: "0x90D4d0D35709D4e29765F5132DaD0E85Fc07aD6A",
    delegationManager: "0x6Ee3cdeB9c1a1aE83CF0bb0E469B98736Cb07CB5",
    organizationRegistry: "0xdF3e6819fC65966d0D43A3768Aaa40fd50B59443",
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
    // "keys" is the session-keystore's home (MASTER_SECRET_PATH =
    // <home>/keys/master.key, created lazily by session-keystore.ts on
    // first use). It is created eagerly here so doctor's directory check
    // covers every directory the runtime owns: 16 in total.
    "keys",
  ];
  for (const d of dirs) {
    const p = join(AGENTIX_HOME, d);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }
}

export { DEFAULT_CONFIG };
