import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export const AGENTIX_HOME = join(homedir(), ".agentix");

export interface AgentixConfig {
  version: string;
  chainId: number;
  rpcUrl: string;
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
}

const DEFAULT_CONFIG: AgentixConfig = {
  version: "1.0.0",
  chainId: 84532,
  rpcUrl: "https://base-sepolia.g.alchemy.com/v2/Pmq9QBdugAMgGijjyff5L",
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
    credentialRegistry: "0xF3Ddc7EB804F73A831Eda878Dd91e2868f96c04d",
    sessionManager: "0xE42B5Db01b44b0Ed614eb6674fE4515644352746",
    agentWalletFactory: "0x1578315Abb36Dc31e73B1873f35B717e7eC55e68",
    capabilityRegistry: "0xc389863Fd6Eb5aD7A53Db2acc9363503129216EF",
    delegationManager: "0xe91aC09282F443724512D778dB442715ed01925D",
    organizationRegistry: "0x18f9D4EBb9cC4F3dA33640d584350CDe493Da6C3",
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
    return { ...DEFAULT_CONFIG, ...saved };
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
