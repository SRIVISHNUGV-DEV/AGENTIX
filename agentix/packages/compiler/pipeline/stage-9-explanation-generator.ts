import { ParsedIntent } from '../types/intent';
import { RiskAssessment } from '../types/risk';
import { ResolvedCapabilities } from '../types/capability';
import { OptimizedPolicy } from '../types/policy';

export interface Explanation {
  plain: string;
  detailed: string;
  json: string;
}

interface Template {
  plain: string;
  detailed: string;
}

const TEMPLATES: Record<string, Template> = {
  wallet_execute: {
    plain: 'Send {value} ETH to {target} from wallet {wallet}',
    detailed: `Action: Execute Transaction
Contract: {contractName} ({contractAddress})
Function: {function}
Value: {value} ETH
Target: {target}
Wallet: {wallet}
Session: {session}
Risk: {riskCategory} (score: {riskScore})
Limits: max value {maxValue}, expires {expiry}`,
  },
  wallet_create: {
    plain: 'Create a new agent wallet for {owner}',
    detailed: `Action: Create Wallet
Owner: {owner}
Factory: {factory}
Risk: {riskCategory} (score: {riskScore})`,
  },
  session_create_lightweight: {
    plain: 'Create a lightweight session on wallet {wallet} with key {sessionKey}',
    detailed: `Action: Create Lightweight Session
Wallet: {wallet}
Session Key: {sessionKey}
Daily Spend Limit: {dailySpendLimit} ETH
Daily TX Limit: {dailyTxLimit}
Expiry: {expiry}
Risk: {riskCategory} (score: {riskScore})`,
  },
  session_revoke: {
    plain: 'Revoke session {sessionId} on wallet {wallet}',
    detailed: `Action: Revoke Session
Session ID: {sessionId}
Wallet: {wallet}
Risk: {riskCategory} (score: {riskScore})`,
  },
  credential_issue: {
    plain: 'Issue credential to agent {agentId} in organization {orgId}',
    detailed: `Action: Issue Credential
Organization: {orgId}
Agent: {agentId}
Permissions: {permissions}
Expiry: {expiry}
Risk: {riskCategory} (score: {riskScore})`,
  },
  credential_revoke: {
    plain: 'Revoke credential of agent {agentId}',
    detailed: `Action: Revoke Credential
Agent: {agentId}
Organization: {orgId}
Risk: {riskCategory} (score: {riskScore})`,
  },
  organization_register: {
    plain: 'Register organization "{name}" owned by {owner}',
    detailed: `Action: Register Organization
Name: {name}
Owner: {owner}
Risk: {riskCategory} (score: {riskScore})`,
  },
  capability_register: {
    plain: 'Register capability "{action}"',
    detailed: `Action: Register Capability
Action: {action}
Risk: {riskCategory} (score: {riskScore})`,
  },
  delegation_create: {
    plain: 'Create delegation from {delegator} to {delegatee} for scope "{scope}"',
    detailed: `Action: Create Delegation
From: {delegator}
To: {delegatee}
Scope: {scope}
Max Value: {maxValue} ETH
Expiry: {expiry}
Risk: {riskCategory} (score: {riskScore})`,
  },
};

const DEFAULT_TEMPLATE: Template = {
  plain: 'Execute {action} with parameters: {params}',
  detailed: `Action: {action}
Normalized: {normalizedAction}
Parameters: {params}
Risk: {riskCategory} (score: {riskScore})`,
};

export class ExplanationGenerator {
  generate(
    intent: ParsedIntent,
    risk: RiskAssessment,
    capabilities?: ResolvedCapabilities,
    policy?: OptimizedPolicy
  ): string {
    const template = TEMPLATES[intent.normalizedAction] || DEFAULT_TEMPLATE;
    const vars = this._extractVariables(intent, risk, capabilities, policy);

    let plain = template.plain;
    let detailed = template.detailed;
    for (const [key, value] of Object.entries(vars)) {
      const re = new RegExp(`\\{${key}\\}`, 'g');
      plain = plain.replace(re, String(value));
      detailed = detailed.replace(re, String(value));
    }

    if (risk.warnings.length > 0) {
      detailed += '\n\nWarnings:';
      for (const w of risk.warnings) {
        detailed += `\n  [${w.severity.toUpperCase()}] ${w.message}`;
      }
    }

    if (risk.suggestions.length > 0) {
      detailed += '\n\nSuggestions:';
      for (const s of risk.suggestions) {
        detailed += `\n  - ${s.message}: ${s.mitigation}`;
      }
    }

    if (risk.requiresApproval) {
      detailed += '\n\n⚠️ This plan requires explicit approval before execution.';
    }

    return JSON.stringify({
      plain,
      detailed,
      intent: intent.normalizedAction,
      risk: risk.category,
      score: risk.score,
      timestamp: Math.floor(Date.now() / 1000),
    });
  }

  private _extractVariables(
    intent: ParsedIntent,
    risk: RiskAssessment,
    capabilities?: ResolvedCapabilities,
    policy?: OptimizedPolicy
  ): Record<string, string> {
    const now = Math.floor(Date.now() / 1000);
    const params = intent.params;

    return {
      action: intent.action,
      normalizedAction: intent.normalizedAction,
      params: JSON.stringify(params),
      value: String(params.value || '0'),
      target: String(params.target || 'N/A'),
      wallet: intent.agent?.walletAddress || String(params.walletAddress || 'N/A'),
      owner: String(params.ownerAddress || intent.agent?.walletAddress || 'N/A'),
      session: intent.sessionId || String(params.sessionId || 'N/A'),
      sessionId: String(params.sessionId || 'N/A'),
      sessionKey: String(params.sessionKey || 'N/A'),
      dailySpendLimit: String(params.dailySpendLimit || '1'),
      dailyTxLimit: String(params.dailyTxLimit || '100'),
      maxValue: policy?.effectiveLimits?.maxValue || String(params.maxValue || '0'),
      expiry: new Date(((intent.limits?.expiry || now + 3600) * 1000)).toISOString(),
      riskCategory: risk.category,
      riskScore: String(risk.score),
      contractName: 'AgentIX',
      contractAddress: 'N/A',
      function: intent.normalizedAction,
      factory: 'AgentWalletFactory',
      orgId: intent.organizationId || String(params.organizationId || 'N/A'),
      agentId: String(intent.agent?.identityId || params.agentId || 'N/A'),
      name: String(params.name || 'N/A'),
      permissions: String(params.permissions || '1'),
      delegator: String(params.delegator || 'N/A'),
      delegatee: String(params.delegatee || 'N/A'),
      scope: String(params.scope || 'N/A'),
      capabilityAction: String(params.action || 'N/A'),
    };
  }
}
