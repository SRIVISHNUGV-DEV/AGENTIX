import { HarnessAdapter, DetectResult, ConnectResult, HealthCheckResult, RepairResult, SyncResult } from "./types";
import { ClaudeCodeAdapter } from "./adapters/claude-code";
import { MimoCodeAdapter } from "./adapters/mimocode";
import { OpenCodeAdapter } from "./adapters/opencode";
import { GitHubCopilotAdapter } from "./adapters/github-copilot";
import { HermesAdapter } from "./adapters/hermes";
import { CursorAdapter } from "./adapters/cursor";
import { GeminiAdapter } from "./adapters/gemini";
import { OpenClaudeAdapter } from "./adapters/openclaude";
import { getEventBus } from "../eventbus";

export interface DetectedHarness {
  adapter: HarnessAdapter;
  detect: DetectResult;
}

export interface ScanResult {
  timestamp: number;
  harnesses: DetectedHarness[];
  totalDetected: number;
  totalConnected: number;
}

export interface ConnectAllResult {
  timestamp: number;
  results: ConnectResult[];
  totalConnected: number;
  totalFailed: number;
}

export interface HealthAllResult {
  timestamp: number;
  results: HealthCheckResult[];
  healthy: number;
  unhealthy: number;
}

class HarnessManager {
  private adapters: HarnessAdapter[] = [
    new ClaudeCodeAdapter(),
    new MimoCodeAdapter(),
    new OpenCodeAdapter(),
    new GitHubCopilotAdapter(),
    new HermesAdapter(),
    new CursorAdapter(),
    new GeminiAdapter(),
    new OpenClaudeAdapter(),
  ];

  /**
   * Returns a copy of the registered adapter list.
   * Why: callers (scan/connect/health) iterate adapters without being able to add or remove entries behind the manager's back.
   * @returns A new array holding the same adapter instances, in registration order; empty only if no adapters were ever registered.
   * @throws Nothing.
   * Maps to: internal — HarnessManager.scanAll / connectAll / healthCheckAll (the iteration source).
   */
  getAdapters(): HarnessAdapter[] {
    return [...this.adapters];
  }

  /**
   * Returns the adapter for one harness id.
   * Why: single-harness operations (connect one, check one) need the adapter by id without scanning everything.
   * @param id Harness id exactly as registered (e.g. "claude-code"); unknown ids return undefined rather than throwing.
   * @returns The matching adapter, or undefined when no adapter has that id.
   * @throws Nothing.
   * Maps to: internal — HarnessManager.scanAll (adapters are looked up by id here first in single-harness flows).
   */
  getAdapter(id: string): HarnessAdapter | undefined {
    return this.adapters.find((a) => a.id === id);
  }

  /**
   * Registers an additional adapter unless one with the same id already exists.
   * Why: third-party or future harnesses can join the manager without editing its built-in list — the id check keeps duplicates from double-scanning.
   * @param adapter The adapter to add; ignored (no-op) when an adapter with the same id is already registered.
   * @returns Nothing.
   * @throws Nothing.
   * Maps to: internal — HarnessManager.scanAll (newly registered adapters are picked up by the next scan).
   * Side effects: appends to the adapter list when the id is new; not persisted across restarts.
   */
  registerAdapter(adapter: HarnessAdapter): void {
    if (!this.adapters.find((a) => a.id === adapter.id)) {
      this.adapters.push(adapter);
    }
  }

  /**
   * Detects every registered harness and reports which are installed and connected.
   * Why: the discovery step every bulk operation starts from — connectAll/repairAll/syncAll all scan first so they only touch harnesses that are actually present.
   * @returns ScanResult with a per-harness DetectResult, totalDetected and totalConnected counts, and a timestamp.
   * @throws Nothing — a throwing adapter is caught per-adapter and reported as found:false with an error HarnessInfo, so one broken adapter never aborts the scan.
   * Maps to: MCP tool agentix_diagnostics (the harness inventory behind diagnostics).
   * Side effects: emits `HarnessDetected` on the event bus for each harness found.
   */
  async scanAll(): Promise<ScanResult> {
    const bus = getEventBus();
    const harnesses: DetectedHarness[] = [];

    for (const adapter of this.adapters) {
      try {
        const detect = await adapter.detect();
        harnesses.push({ adapter, detect });
        if (detect.found) {
          await bus.emit({
            type: "HarnessDetected" as any,
            timestamp: Date.now(),
            data: { harnessId: adapter.id, name: adapter.name, connected: detect.alreadyConnected },
          } as any);
        }
      } catch (e) {
        harnesses.push({
          adapter,
          detect: {
            found: false,
            harness: {
              id: adapter.id,
              name: adapter.name,
              logo: (adapter as any).logo || "",
              configPath: "",
              mcpConfigPath: "",
              status: "error",
              tools: [],
              error: (e as Error).message,
            },
            configExists: false,
            mcpConfigExists: false,
            alreadyConnected: false,
          },
        });
      }
    }

    return {
      timestamp: Date.now(),
      harnesses,
      totalDetected: harnesses.filter((h) => h.detect.found).length,
      totalConnected: harnesses.filter((h) => h.detect.alreadyConnected).length,
    };
  }

  /**
   * Connects every detected-but-not-yet-connected harness.
   * Why: the one-click "wire AgentIX into everything installed" step — already-connected harnesses are skipped, so re-running it is safe.
   * @returns ConnectAllResult with one ConnectResult per harness actually connected (skipped ones produce no entry), plus totalConnected/totalFailed counts.
   * @throws Nothing — a throwing adapter is caught per-adapter and recorded as a failed result.
   * Maps to: MCP config mcpServers.agentix entry (the entry each connect writes).
   * Side effects: scans first (see scanAll), writes MCP configs via each adapter's connect(), and emits `HarnessConnected` per successful connect.
   */
  async connectAll(): Promise<ConnectAllResult> {
    const bus = getEventBus();
    const scan = await this.scanAll();
    const results: ConnectResult[] = [];
    let totalConnected = 0;
    let totalFailed = 0;

    for (const { adapter, detect } of scan.harnesses) {
      if (detect.found && !detect.alreadyConnected) {
        try {
          const result = await adapter.connect();
          results.push(result);
          if (result.success) {
            totalConnected++;
            await bus.emit({
              type: "HarnessConnected" as any,
              timestamp: Date.now(),
              data: { harnessId: adapter.id, name: adapter.name, toolsInstalled: result.toolsInstalled },
            } as any);
          } else {
            totalFailed++;
          }
        } catch (e) {
          results.push({
            success: false,
            harnessId: adapter.id,
            toolsInstalled: 0,
            toolsTotal: 0,
            message: (e as Error).message,
            repairsNeeded: [],
          });
          totalFailed++;
        }
      }
    }

    return { timestamp: Date.now(), results, totalConnected, totalFailed };
  }

  /**
   * Runs healthCheck on every registered adapter, installed or not.
   * Why: the dashboard needs a per-harness verdict even for harnesses that are not installed — unlike connectAll, nothing is skipped here.
   * @returns HealthAllResult with one HealthCheckResult per adapter, plus healthy/unhealthy counts.
   * @throws Nothing — a throwing adapter is caught per-adapter and reported as an unhealthy result with an Error check.
   * Maps to: MCP tool agentix_health (the aggregate health view).
   * Side effects: none beyond each adapter's own detect probes.
   */
  async healthCheckAll(): Promise<HealthAllResult> {
    const results: HealthCheckResult[] = [];
    let healthy = 0;
    let unhealthy = 0;

    for (const adapter of this.adapters) {
      try {
        const result = await adapter.healthCheck();
        results.push(result);
        if (result.healthy) healthy++;
        else unhealthy++;
      } catch (e) {
        results.push({
          healthy: false,
          harnessId: adapter.id,
          checks: [{ name: "Error", status: "ERROR", message: (e as Error).message }],
          message: "Health check failed",
        });
        unhealthy++;
      }
    }

    return { timestamp: Date.now(), results, healthy, unhealthy };
  }

  /**
   * Repairs every detected-but-not-connected harness.
   * Why: the bulk self-heal — one call re-wires stale configs and rebuilds missing MCP servers across all installed harnesses.
   * @returns One RepairResult per harness actually repaired (already-connected or undetected harnesses produce no entry); empty array when nothing needed repair.
   * @throws Nothing — a throwing adapter is caught per-adapter and recorded as a failed repair.
   * Maps to: internal — BaseHarnessAdapter.repair (the per-harness repair this fans out to).
   * Side effects: scans first, may rewrite MCP configs and run `npm run build` via adapters, and emits `HarnessRepaired` per successful repair.
   */
  async repairAll(): Promise<RepairResult[]> {
    const bus = getEventBus();
    const scan = await this.scanAll();
    const results: RepairResult[] = [];

    for (const { adapter, detect } of scan.harnesses) {
      if (detect.found && !detect.alreadyConnected) {
        try {
          const result = await adapter.repair();
          results.push(result);
          if (result.repaired) {
            await bus.emit({
              type: "HarnessRepaired" as any,
              timestamp: Date.now(),
              data: { harnessId: adapter.id, name: adapter.name, repairs: result.repairs.length },
            } as any);
          }
        } catch (e) {
          results.push({
            repaired: false,
            harnessId: adapter.id,
            repairs: [{ component: "unknown", action: "repair", success: false, message: (e as Error).message }],
          });
        }
      }
    }

    return results;
  }

  /**
   * Re-syncs every already-connected harness (re-writes its MCP entry).
   * Why: after an AgentIX upgrade the launch command may have changed — sync refreshes the wiring only where it already exists, without touching disconnected harnesses.
   * @returns One SyncResult per already-connected harness; empty array when none are connected.
   * @throws Nothing — a throwing adapter is swallowed silently (no result is recorded for it), so callers cannot tell a failed sync from a skipped one.
   * Maps to: internal — BaseHarnessAdapter.sync (the per-harness sync this fans out to).
   * Side effects: scans first and rewrites MCP configs via adapters' sync().
   */
  async syncAll(): Promise<SyncResult[]> {
    const scan = await this.scanAll();
    const results: SyncResult[] = [];

    for (const { adapter, detect } of scan.harnesses) {
      if (detect.alreadyConnected) {
        try {
          const result = await adapter.sync();
          results.push(result);
        } catch {}
      }
    }

    return results;
  }

  /**
   * Disconnects every registered adapter, installed or not.
   * Why: the bulk off-ramp — removes the AgentIX entry from all harnesses in one call.
   * @returns One `{ harnessId, success, message }` per adapter, including adapters with no config file (those report success:false, "MCP config not found").
   * @throws Nothing — a throwing adapter is caught per-adapter and recorded as a failure.
   * Maps to: MCP config mcpServers.agentix entry (the entry each disconnect removes).
   * Side effects: rewrites MCP config files via each adapter's disconnect().
   */
  async disconnectAll(): Promise<{ harnessId: string; success: boolean; message: string }[]> {
    const results = [];
    for (const adapter of this.adapters) {
      try {
        const result = await adapter.disconnect();
        results.push({ harnessId: adapter.id, ...result });
      } catch (e) {
        results.push({ harnessId: adapter.id, success: false, message: (e as Error).message });
      }
    }
    return results;
  }
}

let _manager: HarnessManager | null = null;

/**
 * Returns the process-wide HarnessManager singleton, creating it on first use.
 * Why: the adapter registry (including runtime-registered adapters) must be shared, or two managers would scan/connect different harness sets.
 * @returns The shared HarnessManager instance; the same object on every call.
 * @throws Nothing.
 * Maps to: internal — HarnessManager.scanAll / connectAll / healthCheckAll (the bulk operations behind this singleton).
 * Side effects: creates and caches the manager (and its 8 built-in adapters) on first call.
 */
export function getHarnessManager(): HarnessManager {
  if (!_manager) _manager = new HarnessManager();
  return _manager;
}
