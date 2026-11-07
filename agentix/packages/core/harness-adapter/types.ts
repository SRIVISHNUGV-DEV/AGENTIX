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
  /**
   * Detects whether this harness is installed and whether AgentIX is already wired into it.
   * Why: every bulk operation (scan/connect/repair) keys off `found` and `alreadyConnected`, so detection must be strict — config alone is not enough.
   * @returns DetectResult with the HarnessInfo and configExists/mcpConfigExists/alreadyConnected flags.
   * @throws Nothing — detection fails soft (a malformed config reads as not connected).
   * Maps to: internal — HarnessManager.scanAll (which calls detect on every adapter).
   */
  detect(): Promise<DetectResult>;
  /**
   * Installs the AgentIX tools into this harness.
   * Why: the install step of the adapter contract — for this adapter it is exactly connecting the MCP entry; there is no separate package to install.
   * @returns ConnectResult with success and the toolsInstalled/toolsTotal counts.
   * @throws A raw config-write failure may propagate; HarnessManager.connectAll catches it per adapter.
   * Maps to: MCP config mcpServers.agentix entry (installed by writing the entry).
   */
  install(): Promise<ConnectResult>;
  /**
   * Writes the AgentIX MCP entry into this harness's config, creating the config when needed.
   * Why: the one action that actually wires the tools into the harness — detect() only reports, connect() changes state.
   * @returns ConnectResult with success and the toolsInstalled/toolsTotal counts.
   * @throws A raw config-write failure may propagate; HarnessManager.connectAll catches it per adapter.
   * Maps to: MCP config mcpServers.agentix entry (the entry this writes).
   */
  connect(): Promise<ConnectResult>;
  /**
   * Removes the AgentIX MCP entry from this harness's config.
   * Why: the clean off-ramp for connect() — only our entry is removed; the rest of the user's MCP config is left intact.
   * @returns `{ success, message }`; success:false with "MCP config not found" when there is no config file.
   * @throws Nothing — read/parse/write failures are returned as `{ success: false, message }`.
   * Maps to: MCP config mcpServers.agentix entry (the entry this removes).
   */
  disconnect(): Promise<{ success: boolean; message: string }>;
  /**
   * Runs the install / MCP-config / server-build checks for this harness.
   * Why: a single verdict for "is this harness usable right now?" for the dashboard and diagnostics.
   * @returns HealthCheckResult with `healthy` true only when every check passes, plus per-check entries.
   * @throws Nothing — detection fails soft, so a result is returned rather than thrown.
   * Maps to: MCP tool agentix_health (the health surface this backs).
   */
  healthCheck(): Promise<HealthCheckResult>;
  /**
   * Re-wires an already-connected harness (re-writes its MCP entry).
   * Why: the periodic "make sure the wiring is still there" step after an upgrade, when the launch command may have changed.
   * @returns SyncResult with synced = connect success and toolsAdded = tools installed by the reconnect.
   * @throws Nothing — failures surface as synced:false rather than throwing.
   * Maps to: internal — HarnessManager.syncAll (the only caller).
   */
  sync(): Promise<SyncResult>;
  /**
   * Reconnects a disconnected harness and rebuilds the MCP server when it is missing.
   * Why: the self-heal path — a stale config or a missing build is fixed in place instead of surfacing as a manual setup error.
   * @returns RepairResult with `repaired` true only when every repair step succeeded, plus per-component records.
   * @throws Nothing — a failed rebuild is recorded as a failed repair step, not thrown.
   * Maps to: internal — HarnessManager.repairAll (the only caller).
   */
  repair(): Promise<RepairResult>;
  /**
   * Returns the full list of AgentIX tools this harness can call.
   * Why: every harness exposes the same tool surface, so the list is shared rather than duplicated per adapter.
   * @returns The shared tool list (same reference every call — callers must not mutate it).
   * @throws Nothing.
   * Maps to: MCP tool agentix_* — the tool list served to the harness over MCP.
   */
  getTools(): AgentIXTool[];
}
