import { classifyRisk } from "../../shared/constants";
import type { RiskLevel } from "../../shared/types";
import { getEventBus } from "../eventbus";

export interface Intent {
  action: string;
  params: Record<string, any>;
  riskLevel: RiskLevel;
  approved: boolean;
  reason?: string;
}

export class IntentEngine {
  private blockedActions: Set<string> = new Set(["deployContract", "transferAll", "selfDestruct"]);

  classify(action: string, params: Record<string, any>): Intent {
    const riskLevel = classifyRisk(action);
    const blocked = this.blockedActions.has(action);

    return {
      action,
      params,
      riskLevel,
      approved: !blocked,
      reason: blocked ? `Action '${action}' is blocked by policy` : undefined,
    };
  }

  blockAction(action: string): void {
    this.blockedActions.add(action);
  }

  unblockAction(action: string): void {
    this.blockedActions.delete(action);
  }
}

export class PolicyEngine {
  private maxDailyActions = 1000;
  private maxDailyValue = BigInt("100000000000000000000");
  private actionCounts: Map<string, number> = new Map();
  private lastReset = Date.now();

  validate(intent: Intent): { valid: boolean; reason?: string } {
    this.checkReset();

    if (intent.riskLevel === "AUTHORITY") {
      return { valid: false, reason: "Authority actions require manual approval" };
    }

    const count = this.actionCounts.get(intent.action) || 0;
    if (count >= this.maxDailyActions) {
      return { valid: false, reason: `Daily limit reached for action: ${intent.action}` };
    }

    this.actionCounts.set(intent.action, count + 1);
    return { valid: true };
  }

  private checkReset(): void {
    const now = Date.now();
    if (now - this.lastReset > 86400000) {
      this.actionCounts.clear();
      this.lastReset = now;
    }
  }
}

export class SafetyEngine {
  private requireApproval: Set<string> = new Set([
    "executeTransaction", "executeBatch", "revokeCredential",
    "deactivateOrganization", "whitelistAddress",
  ]);

  async check(intent: Intent): Promise<{ safe: boolean; requiresApproval: boolean; reason?: string }> {
    if (intent.riskLevel === "AUTHORITY") {
      return { safe: false, requiresApproval: true, reason: "Authority action — manual approval required" };
    }

    if (this.requireApproval.has(intent.action)) {
      return { safe: true, requiresApproval: true, reason: `${intent.action} requires user approval` };
    }

    if (intent.riskLevel === "HIGH") {
      return { safe: true, requiresApproval: true, reason: "High-risk action — review recommended" };
    }

    return { safe: true, requiresApproval: false };
  }
}

export class ToolRouter {
  private intentEngine = new IntentEngine();
  private policyEngine = new PolicyEngine();
  private safetyEngine = new SafetyEngine();
  private bus = getEventBus();

  async route(action: string, params: Record<string, any>, executor: (intent: Intent) => Promise<any>): Promise<{ result?: any; error?: string; requiresApproval?: boolean }> {
    const intent = this.intentEngine.classify(action, params);

    if (!intent.approved) {
      await this.bus.emit({ type: "ReplayBlocked", data: { reason: intent.reason! } });
      return { error: intent.reason };
    }

    const policyCheck = this.policyEngine.validate(intent);
    if (!policyCheck.valid) {
      return { error: policyCheck.reason };
    }

    const safetyCheck = await this.safetyEngine.check(intent);
    if (safetyCheck.requiresApproval) {
      return { requiresApproval: true, error: safetyCheck.reason };
    }

    try {
      const result = await executor(intent);
      await this.bus.emit({ type: "ActionExecuted", data: { action, success: true } });
      return { result };
    } catch (e: any) {
      await this.bus.emit({ type: "ActionExecuted", data: { action, success: false } });
      return { error: e.message };
    }
  }
}

let _router: ToolRouter | null = null;
export function getToolRouter(): ToolRouter {
  if (!_router) _router = new ToolRouter();
  return _router;
}
