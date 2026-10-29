import { Compiler, ExecutionPlan, CompilerContext, CompilationResult } from '../packages/compiler';
import { loadConfig } from './core/config';
import { logger } from './core/logger';
import { getEventBus } from '../packages/core/eventbus';
import { runExecute } from './core/database';
import { checkPolicy, getOwnerPolicy, parseValueToWei, type PolicyCheck } from './core/owner-policy';
import { normalizeAction } from '../packages/compiler/pipeline/stage-1-intent-parser';

export interface GatewayResult {
  success: boolean;
  txHash?: string;
  errors?: string[];
  warnings?: string[];
  requiresApproval?: boolean;
  plan?: ExecutionPlan;
  explanation?: string;
  policyCheck?: PolicyCheck;
  durationMs?: number;
  cacheHit?: boolean;
}

// Actions the agent can do freely (read-only, no value transfer)
const AGENT_FREE_ACTIONS = new Set([
  'wallet_info',
  'wallet_list',
  'wallet_balance',
  'session_validate',
  'session_list',
  'session_get',
  'session_status',
  'credential_get',
  'credential_list',
  'credential_verify',
  'organization_get',
  'organization_list',
  'capability_list',
  'delegation_list',
  'tree_status',
  'proof_list',
  'proof_verify',
  'identity_lookup',
  'identity_get',
]);

// Actions that always require owner approval
const OWNER_ONLY_ACTIONS = new Set([
  'wallet_create',
  'wallet_transfer_ownership',
  'organization_register',
  'organization_deactivate',
  'capability_register',
]);

// Authority writes with no wallet scope (R-2). Delegation roots and
// credential roots are not wallet-scoped — their encoder params carry no
// walletAddress — so a wallet-keyed policy check can never cover them.
// They are NOT auto-executed: they return requiresApproval like
// owner-only actions, and only an owner decision (dashboard approval,
// token-gated REST approve) lets them run. This is the fail-closed middle
// path between "silently skip policy" (the bug) and "hard-deny and delete
// the CLI credential/delegation flows" (the alternative, rejected because
// owner-mediated execution of these actions is legitimate).
// Since the C-5 timelock fix, root WRITES are two-step: the *_create /
// *_issue / *_update_root actions PROPOSE (no immediate on-chain effect)
// and the *_accept_root actions COMPLETE a proposal after the 2-day
// timelock. Both halves are authority-gated here. NOTE: approving a plan
// only marks it APPROVED — no path in this codebase executes an approved
// plan on-chain (CLI/REST execute-plan flip status only). The executable
// propose/accept surface is the SDK, the CLI, and the REST root routes;
// the gateway actions exist so plans compile with correct encodings.
const AUTHORITY_ONLY_ACTIONS = new Set([
  'delegation_create',
  'delegation_accept_root',
  'delegation_cancel_root',
  'credential_issue',
  'credential_revoke',
  'credential_update_root',
  'credential_accept_root',
  'credential_accept_revoked_root',
  'credential_cancel_root',
  'credential_cancel_revoked_root',
  'anchor_accept_root',
  'anchor_accept_revoked_root',
  'anchor_cancel_root',
  'anchor_cancel_revoked_root',
]);

export class CompilerGateway {
  private compiler: Compiler;

  constructor() {
    this.compiler = Compiler.getInstance();
  }

  async executeIntent(
    action: string,
    params: Record<string, unknown>,
    source: 'cli' | 'sdk' | 'rest' | 'mcp' | 'dashboard' | 'nl' = 'mcp',
    context?: CompilerContext
  ): Promise<GatewayResult> {
    const start = Date.now();

    try {
      // 0. Guard input types. Callers (REST/MCP/SDK) may pass hostile or malformed
      // values; reject non-string actions and non-object params with a clean error
      // instead of letting them throw deep in the pipeline (e.g. action.toLowerCase
      // or SQLite bind failures).
      if (typeof action !== 'string' || action.length === 0) {
        return { success: false, errors: ['Invalid action: expected a non-empty string'], durationMs: Date.now() - start };
      }
      if (params === null || typeof params !== 'object' || Array.isArray(params)) {
        return { success: false, errors: ['Invalid params: expected an object'], durationMs: Date.now() - start };
      }

      // 1. NORMALISE FIRST (R-1). Every gate below runs on the canonical
      // action name. The pre-fix code gated on the raw spelling while the
      // compiler executed the normalised one, so `new_capability` (alias
      // for the owner-only `capability_register`) and case variants
      // (`WALLET_CREATE`) sailed past the owner-only check. The original
      // spelling is still passed to the compiler (which normalises
      // internally) and recorded in the action log; only the GATES use
      // the normalised name.
      const normalized = normalizeAction(action);

      // 2. Read-only actions: skip policy check, just return info
      if (AGENT_FREE_ACTIONS.has(normalized)) {
        return { success: true, durationMs: Date.now() - start };
      }

      // 3. Owner-only actions: always require approval
      if (OWNER_ONLY_ACTIONS.has(normalized)) {
        return {
          success: false,
          requiresApproval: true,
          explanation: `Action "${normalized}" requires owner approval. Use the dashboard to sign.`,
          durationMs: Date.now() - start,
        };
      }

      // 4. Authority writes with no wallet scope: require approval, never
      // auto-execute (R-2). A missing walletAddress must not silently
      // convert "policy-checked" into "no policy check".
      if (AUTHORITY_ONLY_ACTIONS.has(normalized)) {
        return {
          success: false,
          requiresApproval: true,
          explanation: `Action "${normalized}" is an authority write (delegation/credential root) and requires owner approval. Use the dashboard to sign.`,
          durationMs: Date.now() - start,
        };
      }

      // 5. Check owner policy, on the normalised action, unconditionally
      // for non-free actions (R-2). The wallet scope comes from params
      // ONLY — never from a caller-supplied context object (the REST
      // /api/execute handler used to pass body.context straight through,
      // letting a requester choose which wallet's policy applied). A
      // state-changing action with no walletAddress is DENIED, not
      // policy-skipped: there is no wallet whose policy could approve it.
      const walletAddress = (params.walletAddress || '') as string;
      if (!walletAddress) {
        return {
          success: false,
          errors: [`Action "${normalized}" requires a walletAddress: no owner policy can be checked without a wallet scope.`],
          durationMs: Date.now() - start,
        };
      }
      const policyCheck = checkPolicy(walletAddress, normalized, params);
      if (!policyCheck.allowed) {
        logger.info("gateway", `Policy blocked ${normalized}: ${policyCheck.reason}`);
        return {
          success: false,
          requiresApproval: true,
          explanation: policyCheck.reason,
          policyCheck,
          durationMs: Date.now() - start,
        };
      }

      // 6. Get contract addresses from config
      const config = loadConfig();
      const contractAddresses: Record<string, string> = {
        AgentWalletFactory: config.contracts.agentWalletFactory,
        AgentWallet: config.contracts.agentWalletImplementation,
        SessionManager: config.contracts.sessionManager,
        CredentialRegistry: config.contracts.credentialRegistry,
        OrganizationRegistry: config.contracts.organizationRegistry,
        CapabilityRegistry: config.contracts.capabilityRegistry,
        DelegationManager: config.contracts.delegationManager,
        AgentIdentity: config.contracts.agentIdentity,
      };

      // 7. Compile through the 10-stage pipeline
      const result = await this.compiler.compileIntent(
        action, params, source, context, contractAddresses
      );

      const durationMs = Date.now() - start;

      if (result.errors.length > 0) {
        logger.warn("gateway", `Compilation failed for ${normalized}: ${result.errors.join('; ')}`);
        return {
          success: false,
          errors: result.errors,
          warnings: result.warnings,
          durationMs,
          cacheHit: result.cacheHit,
        };
      }

      const plan = result.plan;

      // 8. Log the intent (tool = normalised name; raw spelling in metadata)
      this._logAction(normalized, params, plan, 'compiled', undefined, action);

      // 9. Check risk — if requires approval, return plan for human review
      if (plan.risk.requiresApproval) {
        logger.info("gateway", `Action ${normalized} requires approval (risk: ${plan.risk.category}, score: ${plan.risk.score})`);
        return {
          success: false,
          requiresApproval: true,
          plan,
          explanation: plan.explanation,
          warnings: result.warnings,
          durationMs,
          cacheHit: result.cacheHit,
        };
      }

      // 10. Auto-approve within-policy plans
      this.compiler.approvePlan(plan.planId);
      this.compiler.executePlan(plan.planId);

      // 11. Execute the transaction on-chain
      const txResult = await this._executePlanOnChain(plan);

      // 12. Update plan status
      if (txResult.success) {
        this.compiler.completePlan(plan.planId, txResult.txHash!);
        this._logAction(normalized, params, plan, 'completed', txResult.txHash, action);
        logger.info("gateway", `Action ${normalized} completed: ${txResult.txHash}`);
      } else {
        this.compiler.failPlan(plan.planId, txResult.errors?.join('; ') || 'Execution failed');
        this._logAction(normalized, params, plan, 'failed', undefined, action);
        logger.warn("gateway", `Action ${normalized} failed: ${txResult.errors?.join('; ')}`);
      }

      return {
        ...txResult,
        warnings: [...(result.warnings || []), ...(txResult.warnings || [])],
        durationMs,
        cacheHit: result.cacheHit,
      };
    } catch (err: any) {
      const durationMs = Date.now() - start;
      logger.error("gateway", `Gateway error for ${action}: ${err.message}`);
      return {
        success: false,
        errors: [err.message],
        durationMs,
      };
    }
  }

  async getCapabilityEnvelope(
    walletAddress: string,
    sessionId?: string
  ): Promise<Record<string, unknown>> {
    const config = loadConfig();
    const { getProvider } = await import('./core/provider');
    const provider = getProvider();
    const { ethers } = await import('ethers');

    const policy = getOwnerPolicy(walletAddress);

    const balance = await provider.getBalance(walletAddress);
    const balanceEth = ethers.formatEther(balance);

    const iface = new ethers.Interface(["function balanceOf(address) view returns (uint256)"]);
    const calldata = iface.encodeFunctionData("balanceOf", [walletAddress]);
    let depositEth = "0";
    try {
      const result = await provider.call({ to: config.contracts.entryPoint, data: calldata });
      const deposit = BigInt(iface.decodeFunctionResult("balanceOf", result)[0].toString());
      depositEth = ethers.formatEther(deposit);
    } catch {}

    return {
      wallet: walletAddress,
      budget: {
        total: `${balanceEth} ETH`,
        remaining: `${balanceEth} ETH`,
        deposit: `${depositEth} ETH`,
        dailyLimit: policy?.dailyLimit || 'none',
        perTxLimit: policy?.perTxLimit || 'none',
      },
      session: sessionId ? { id: sessionId, type: "lightweight" } : null,
      allowed: policy?.allowedActions || ['wallet_execute'],
      forbidden: policy?.forbiddenActions || ['wallet_transfer_ownership', 'wallet_withdraw'],
      network: config.networkName,
      chainId: config.chainId,
      hasPolicy: !!policy,
    };
  }

  listPlans(status?: string, limit?: number): ExecutionPlan[] {
    return this.compiler.listPlans(status, limit);
  }

  getPlan(planId: string): ExecutionPlan | null {
    return this.compiler.getPlan(planId);
  }

  approvePlan(planId: string): ExecutionPlan | null {
    return this.compiler.approvePlan(planId);
  }

  rejectPlan(planId: string, reason: string): ExecutionPlan | null {
    return this.compiler.rejectPlan(planId, reason);
  }

  private async _executePlanOnChain(plan: ExecutionPlan): Promise<GatewayResult> {
    // R-1 defense in depth: re-check the normalised name HERE, at the last
    // code before the signer sends. A plan built outside executeIntent
    // (e.g. via /api/compile) carries whatever normalizedAction its builder
    // set; if either the raw action or the plan's normalised action is an
    // owner-only or authority action, refuse — approval-gated actions must
    // never auto-execute through this path. Encoding still uses the plan's
    // normalised action (the pipeline's mapping), not our re-normalisation,
    // so existing flows (e.g. session_create, which has no encoder entry
    // under its raw name) are untouched.
    const rawNormalized = normalizeAction(plan.intent.action);
    const action = plan.intent.normalizedAction || rawNormalized;
    if (
      OWNER_ONLY_ACTIONS.has(rawNormalized) || OWNER_ONLY_ACTIONS.has(normalizeAction(action)) ||
      AUTHORITY_ONLY_ACTIONS.has(rawNormalized) || AUTHORITY_ONLY_ACTIONS.has(normalizeAction(action))
    ) {
      return { success: false, errors: [`Action "${action}" requires owner approval and cannot auto-execute`] };
    }
    const params = plan.intent.params || {};

    // Encode the action into address-validated, ABI-encoded calldata. This is the
    // single correct path: it resolves the target through ProxyGuard, encodes the
    // ordered ABI args, and asserts the target is actually deployed on this chain
    // before we sign anything. (Previously the gateway sent raw node args, which
    // produced empty calldata for any action whose params weren't pre-hex.)
    let encoded;
    try {
      const { encodeAndValidate, isEncodableAction } = await import('./core/action-encoder');
      if (!isEncodableAction(action)) {
        return { success: false, errors: [`Action "${action}" cannot be executed on-chain (no encoder)`] };
      }
      encoded = await encodeAndValidate(action, params);
    } catch (err: any) {
      return { success: false, errors: [`Encoding/validation failed for ${action}: ${err.message}`] };
    }

    try {
      const { getSigner } = await import('./core/provider');
      const signer = getSigner();

      const tx = await signer.sendTransaction({
        to: encoded.to,
        data: encoded.data,
        value: encoded.value,
      });

      const receipt = await tx.wait();
      const txHash = receipt?.hash ?? tx.hash;

      await getEventBus().emit({
        type: "WalletExecuted",
        data: {
          walletAddress: plan.intent.agent?.walletAddress || (params.walletAddress as string) || '',
          target: encoded.to,
          value: encoded.value.toString(),
          txHash,
        },
      });

      return { success: true, txHash };
    } catch (err: any) {
      return { success: false, errors: [`${encoded.contractName}.${encoded.functionName}: ${err.message}`] };
    }
  }

  private _logAction(
    action: string,
    params: Record<string, unknown>,
    plan: ExecutionPlan,
    status: string,
    txHash?: string,
    rawAction?: string
  ): void {
    try {
      // NOTE: the agent_actions table has `metadata` (not `details`) and a
      // dedicated `tx_hash` column. The value moved is stored inside metadata as
      // `value` so both the owner-policy daily-limit query and the risk engine's
      // behavioral-history builder can read it back. It is stored WEI-NORMALISED
      // (parseValueToWei): the daily-limit query sums it as an integer, so a
      // raw decimal ("0.1") would silently sum as 0. Values that fail parsing
      // cannot reach here through the gateway (policy denies them first); the
      // raw string is kept as a fallback so the row still records the attempt.
      let valueWei: string;
      try {
        valueWei = parseValueToWei((params.value as string) || '0').toString();
      } catch {
        valueWei = String((params.value as string) || '0');
      }
      const metadata = JSON.stringify({
        planId: plan.planId,
        value: valueWei,
        target: (params.target || params.recipient || params.delegatee || '') as string,
        riskScore: plan.risk.score,
        riskCategory: plan.risk.category,
        decision: plan.risk.decision,
        txHash,
        rawAction: rawAction && rawAction !== action ? rawAction : undefined,
      });
      runExecute(
        `INSERT INTO agent_actions (wallet_address, session_id, tool, intent, risk_level, tx_hash, success, metadata, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        plan.intent.agent?.walletAddress || (params.walletAddress as string) || '',
        plan.intent.sessionId || '',
        action,
        JSON.stringify(params),
        plan.risk.category,
        txHash || null,
        status === 'completed' ? 1 : 0,
        metadata,
        Math.floor(Date.now() / 1000)
      );
    } catch (err: any) {
      logger.warn('gateway', `Failed to log action ${action}: ${err.message}`);
    }
  }
}

let _gateway: CompilerGateway | null = null;

export function getCompilerGateway(): CompilerGateway {
  if (!_gateway) _gateway = new CompilerGateway();
  return _gateway;
}
