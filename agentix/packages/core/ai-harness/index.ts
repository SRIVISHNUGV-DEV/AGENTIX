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

  /**
   * Classifies an action into an Intent with its risk tier and blocked/approved verdict.
   * Why: the first gate in ToolRouter.route — every action is classified before any policy, safety or execution step sees it.
   * @param action Action name, matched exactly against the blocklist and RISK_LEVELS; unknown names classify LOW (see classifyRisk).
   * @param params Caller-supplied arguments, passed through untouched — classification never inspects them.
   * @returns An Intent carrying the action, params, riskLevel, and approved=false with a reason when blocked.
   * @throws Nothing — pure lookup.
   * Maps to: internal — ToolRouter.route (first gate before PolicyEngine.validate).
   */
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

  /**
   * Adds an action to the runtime blocklist so future classifications reject it.
   * Why: lets an operator kill a dangerous action without redeploying; the default blocklist covers only deployContract, transferAll and selfDestruct.
   * @param action Exact action name to block; adding an already-blocked name is a no-op.
   * @returns Nothing.
   * @throws Nothing.
   * Maps to: internal — IntentEngine.classify (the blocklist it consults).
   * Side effects: mutates this engine's in-memory blocklist only — it is not persisted, so a restart restores the defaults.
   * Security note: there is no auth check here — any code holding the engine can block (or, via unblockAction, unblock) actions, so only trusted operator code should reach it.
   */
  blockAction(action: string): void {
    this.blockedActions.add(action);
  }

  /**
   * Removes an action from the runtime blocklist so it can be classified (and executed) again.
   * Why: the escape hatch for blockAction — e.g. re-enabling an action after the incident that blocked it is resolved.
   * @param action Exact action name to unblock; removing a name that was never blocked is a no-op.
   * @returns Nothing.
   * @throws Nothing.
   * Maps to: internal — IntentEngine.classify (the blocklist it consults).
   * Side effects: mutates this engine's in-memory blocklist only; not persisted across restarts.
   * Security note: unblocking re-enables execution of that action — treat it as a privileged operator step, not a routine call.
   */
  unblockAction(action: string): void {
    this.blockedActions.delete(action);
  }
}

export class PolicyEngine {
  private maxDailyActions = 1000;
  private actionCounts: Map<string, number> = new Map();
  private lastReset = Date.now();

  /**
   * Validates an intent against the daily per-action quota, counting the attempt.
   * Why: the second gate in ToolRouter.route — a runaway or looping agent cannot fire the same action unboundedly in one day.
   * @param intent Classified intent; AUTHORITY intents are always rejected here (they need manual approval, never auto-validation).
   * @returns `{ valid: true }` on success (and the attempt is counted), or `{ valid: false, reason }` when the action is AUTHORITY or its daily count hit maxDailyActions (1000).
   * @throws Nothing — returns a verdict object instead of throwing.
   * Maps to: policy rule daily-action-limit (1000 attempts per action per rolling 24h window).
   * Side effects: increments this action's count on every successful validation, and clears all counts when more than 24h elapsed since the last reset — so the "day" is a rolling window from engine start, not a calendar day.
   */
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

  /**
   * Clears all per-action counts when over 24h passed since the last reset.
   * Why: the quota is a rolling window, so counts must age out without an external scheduler or cron.
   * @returns Nothing.
   * @throws Nothing.
   * Maps to: internal — PolicyEngine.validate (called at the top of every validation).
   * Side effects: clears actionCounts and moves lastReset to now when the window elapsed; otherwise leaves state untouched.
   */
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

  /**
   * Decides whether an intent may run unattended or needs a human to approve it.
   * Why: the third gate in ToolRouter.route — value-moving and authority actions must never execute on the agent's say-so alone.
   * @param intent Classified intent; AUTHORITY is unsafe-by-definition here, listed actions and HIGH risk need approval.
   * @returns `{ safe, requiresApproval, reason? }` — AUTHORITY returns safe:false + approval; listed/HIGH actions return safe:true + approval; anything else returns safe:true with no approval.
   * @throws Nothing — pure lookup; async only to match the gate interface.
   * Maps to: internal — ToolRouter.route (approval gate before the executor runs).
   * Security note: this is advisory — it only returns a verdict; the caller must actually halt on requiresApproval, or the check is worthless.
   */
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

  /**
   * Runs one action through classify → policy → safety, then executes it if all gates pass.
   * Why: the single choke point for agent actions — no tool call may reach an executor without passing every gate, so limits and approvals cannot be bypassed by calling an executor directly.
   * @param action Action name routed through IntentEngine.classify.
   * @param params Caller arguments, forwarded to the executor inside the classified intent.
   * @param executor The real work; invoked at most once, only after all gates pass, and only with the classified intent.
   * @returns `{ result }` on success; `{ error }` when blocked, over quota, or the executor threw; `{ requiresApproval: true, error }` when a human must approve first — the action is NOT executed in that case.
   * @throws Nothing — executor failures are caught and returned as `{ error: message }`, so callers must check the result shape instead of try/catch.
   * Maps to: MCP tool agentix_* — every MCP tool funnels through this router before execution.
   * Side effects: emits `ReplayBlocked` on the event bus for blocked intents and `ActionExecuted` (success true/false) after every executed attempt.
   * Security note: the executor runs with whatever authority the caller holds — this router gates *whether* it runs, not *what* it can do once running.
   */
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
/**
 * Returns the process-wide ToolRouter singleton, creating it on first use.
 * Why: the gates (blocklist, daily counts) are per-instance state, so every caller must share one router or limits could be bypassed by minting a fresh one.
 * @returns The shared ToolRouter instance; the same object on every call.
 * @throws Nothing.
 * Maps to: internal — ToolRouter.route (the singleton all tool dispatch shares).
 * Side effects: creates and caches the router (and its engines + event-bus handle) on first call; not thread-safe, but JS is single-threaded here.
 */
export function getToolRouter(): ToolRouter {
  if (!_router) _router = new ToolRouter();
  return _router;
}
