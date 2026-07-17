import { Compiler, ExecutionPlan, CompilerContext, CompilationResult } from '../packages/compiler';
import { loadConfig } from './core/config';
import { logger } from './core/logger';
import { getEventBus } from '../packages/core/eventbus';
import { runExecute } from './core/database';
import { checkPolicy, getOwnerPolicy, type PolicyCheck } from './core/owner-policy';

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

      // 1. Read-only actions: skip policy check, just return info
      if (AGENT_FREE_ACTIONS.has(action)) {
        return { success: true, durationMs: Date.now() - start };
      }

      // 2. Owner-only actions: always require approval
      if (OWNER_ONLY_ACTIONS.has(action)) {
        return {
          success: false,
          requiresApproval: true,
          explanation: `Action "${action}" requires owner approval. Use the dashboard to sign.`,
          durationMs: Date.now() - start,
        };
      }

      // 3. Check owner policy
      const walletAddress = (params.walletAddress || context?.walletAddress || '') as string;
      if (walletAddress) {
        const policyCheck = checkPolicy(walletAddress, action, params);

        if (!policyCheck.allowed) {
          logger.info("gateway", `Policy blocked ${action}: ${policyCheck.reason}`);
          return {
            success: false,
            requiresApproval: true,
            explanation: policyCheck.reason,
            policyCheck,
            durationMs: Date.now() - start,
          };
        }
      }

      // 4. Get contract addresses from config
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

      // 5. Compile through the 10-stage pipeline
      const result = await this.compiler.compileIntent(
        action, params, source, context, contractAddresses
      );

      const durationMs = Date.now() - start;

      if (result.errors.length > 0) {
        logger.warn("gateway", `Compilation failed for ${action}: ${result.errors.join('; ')}`);
        return {
          success: false,
          errors: result.errors,
          warnings: result.warnings,
          durationMs,
          cacheHit: result.cacheHit,
        };
      }

      const plan = result.plan;

      // 6. Log the intent
      this._logAction(action, params, plan, 'compiled');

      // 7. Check risk — if requires approval, return plan for human review
      if (plan.risk.requiresApproval) {
        logger.info("gateway", `Action ${action} requires approval (risk: ${plan.risk.category}, score: ${plan.risk.score})`);
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

      // 8. Auto-approve within-policy plans
      this.compiler.approvePlan(plan.planId);
      this.compiler.executePlan(plan.planId);

      // 9. Execute the transaction on-chain
      const txResult = await this._executePlanOnChain(plan);

      // 10. Update plan status
      if (txResult.success) {
        this.compiler.completePlan(plan.planId, txResult.txHash!);
        this._logAction(action, params, plan, 'completed', txResult.txHash);
        logger.info("gateway", `Action ${action} completed: ${txResult.txHash}`);
      } else {
        this.compiler.failPlan(plan.planId, txResult.errors?.join('; ') || 'Execution failed');
        this._logAction(action, params, plan, 'failed');
        logger.warn("gateway", `Action ${action} failed: ${txResult.errors?.join('; ')}`);
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
      allowed: policy?.allowedActions || ['wallet.execute'],
      forbidden: policy?.forbiddenActions || ['changeOwner', 'upgradeImplementation'],
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
    const action = plan.intent.normalizedAction || plan.intent.action;
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
    txHash?: string
  ): void {
    try {
      // NOTE: the agent_actions table has `metadata` (not `details`) and a
      // dedicated `tx_hash` column. The value moved is stored inside metadata as
      // `value` so both the owner-policy daily-limit query and the risk engine's
      // behavioral-history builder can read it back.
      const metadata = JSON.stringify({
        planId: plan.planId,
        value: (params.value as string) || '0',
        target: (params.target || params.recipient || params.delegatee || '') as string,
        riskScore: plan.risk.score,
        riskCategory: plan.risk.category,
        decision: plan.risk.decision,
        txHash,
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
