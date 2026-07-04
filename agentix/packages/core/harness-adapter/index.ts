import { HarnessAdapter, DetectResult, ConnectResult, HealthCheckResult, RepairResult, SyncResult } from "./types";
import { ClaudeCodeAdapter } from "./adapters/claude-code";
import { MimoCodeAdapter } from "./adapters/mimocode";
import { OpenCodeAdapter } from "./adapters/opencode";
import { GitHubCopilotAdapter } from "./adapters/github-copilot";
import { HermesAdapter } from "./adapters/hermes";
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
  ];

  getAdapters(): HarnessAdapter[] {
    return [...this.adapters];
  }

  getAdapter(id: string): HarnessAdapter | undefined {
    return this.adapters.find((a) => a.id === id);
  }

  registerAdapter(adapter: HarnessAdapter): void {
    if (!this.adapters.find((a) => a.id === adapter.id)) {
      this.adapters.push(adapter);
    }
  }

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

export function getHarnessManager(): HarnessManager {
  if (!_manager) _manager = new HarnessManager();
  return _manager;
}
