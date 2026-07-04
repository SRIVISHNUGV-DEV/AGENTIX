export type HarnessStatus = "detected" | "connected" | "disconnected" | "error" | "repairing";

export interface HarnessInfo {
  id: string;
  name: string;
  logo: string;
  version?: string;
  configPath: string;
  mcpConfigPath: string;
  status: HarnessStatus;
  tools: ToolInfo[];
  lastChecked?: number;
  error?: string;
  /** Wallet address this harness is mapped to (if identity is assigned). */
  walletAddress?: string;
  /** AgentIX identity ID this harness is linked to. */
  identityId?: string;
}

export interface ToolInfo {
  name: string;
  description: string;
  installed: boolean;
  version?: string;
}

export interface DetectResult {
  found: boolean;
  harness: HarnessInfo;
  configExists: boolean;
  mcpConfigExists: boolean;
  alreadyConnected: boolean;
}

export interface ConnectResult {
  success: boolean;
  harnessId: string;
  toolsInstalled: number;
  toolsTotal: number;
  message: string;
  repairsNeeded: string[];
}

export interface HealthCheckResult {
  healthy: boolean;
  harnessId: string;
  checks: HealthCheck[];
  message: string;
}

export interface HealthCheck {
  name: string;
  status: "PASS" | "WARNING" | "ERROR";
  message: string;
}

export interface SyncResult {
  synced: boolean;
  harnessId: string;
  toolsAdded: number;
  toolsRemoved: number;
  toolsUpdated: number;
}

export interface RepairResult {
  repaired: boolean;
  harnessId: string;
  repairs: RepairAction[];
}

export interface RepairAction {
  component: string;
  action: string;
  success: boolean;
  message: string;
}

export interface AgentIXTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPConfig {
  mcpServers?: Record<string, MCPEntry>;
}

export interface MCPEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
}

export interface HarnessAdapter {
  readonly id: string;
  readonly name: string;
  detect(): Promise<DetectResult>;
  install(): Promise<ConnectResult>;
  connect(): Promise<ConnectResult>;
  disconnect(): Promise<{ success: boolean; message: string }>;
  healthCheck(): Promise<HealthCheckResult>;
  sync(): Promise<SyncResult>;
  repair(): Promise<RepairResult>;
  getTools(): AgentIXTool[];
}
