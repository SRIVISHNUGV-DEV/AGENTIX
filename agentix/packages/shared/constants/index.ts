export const RISK_LEVELS = {
  LOW: ["read", "list", "get", "status", "health", "diagnostics", "config", "help", "export"] as const,
  MEDIUM: ["createWallet", "createSession", "generateProof", "createBackup", "createDelegation", "registerCapability"] as const,
  HIGH: ["issueCredential", "revokeCredential", "whitelistAddress", "executeTransaction", "executeBatch"] as const,
  AUTHORITY: ["createOrganization", "deactivateOrganization", "rotateAnchors"] as const,
} as const;

export function classifyRisk(action: string): "LOW" | "MEDIUM" | "HIGH" | "AUTHORITY" {
  if ((RISK_LEVELS.AUTHORITY as readonly string[]).includes(action)) return "AUTHORITY";
  if ((RISK_LEVELS.HIGH as readonly string[]).includes(action)) return "HIGH";
  if ((RISK_LEVELS.MEDIUM as readonly string[]).includes(action)) return "MEDIUM";
  return "LOW";
}

export const TREE_DEPTH = 20;
export const TREE_SIZE = 2 ** TREE_DEPTH;
export const ZERO_VALUE = BigInt(0);

export const MAX_SESSIONS_PER_WALLET = 100;
export const REQUEST_EXPIRY_SECONDS = 86400;
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX = 10;

export const NETWORK = {
  name: "Base Sepolia",
  chainId: 84532,
  rpcUrl: "https://sepolia.base.org",
  explorerUrl: "https://sepolia.basescan.org",
} as const;

export const DEFAULT_CONFIG_PATH = "~/.agentix/config/agentix.config.json";
export const DEFAULT_DB_PATH = "~/.agentix/db/agentix.db";
