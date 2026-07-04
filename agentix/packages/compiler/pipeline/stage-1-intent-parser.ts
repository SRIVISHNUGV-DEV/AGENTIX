import { StructuredIntent, ParsedIntent, IntentIR, NL_PATTERNS, IntentSource, IntentPriority } from '../types/intent';
import { CompilerConfig } from '../types/compilation';
import { generateId } from '@agentix/utils';

export class IntentParser {
  constructor(private config: CompilerConfig) {}

  parse(input: StructuredIntent | string): ParsedIntent {
    let structured: StructuredIntent;

    if (typeof input === 'string') {
      if (!this.config.naturalLanguageEnabled) {
        return this._errorIntent('Natural language parsing is disabled. Provide a structured intent.', 'unknown');
      }
      structured = this._parseNL(input);
    } else {
      structured = input;
    }

    const normalizedAction = this._normalizeAction(structured.action);
    const id = generateId();
    const now = Math.floor(Date.now() / 1000);

    const parsed: ParsedIntent = {
      version: 1,
      id,
      source: structured.source || IntentSource.SDK,
      action: structured.action,
      normalizedAction,
      params: structured.params || {},
      agent: structured.params.agent as ParsedIntent['agent'] | undefined,
      organizationId: structured.params.organizationId as string | undefined,
      sessionId: structured.params.sessionId as string | undefined,
      limits: structured.params.limits as ParsedIntent['limits'] | undefined,
      targets: structured.params.targets as string[] | undefined,
      requestedAt: now,
      priority: (structured.params.priority as IntentPriority) || IntentPriority.NORMAL,
      idempotencyKey: (structured.params.idempotencyKey as string) || id,
      validationErrors: [],
    };

    return parsed;
  }

  private _parseNL(text: string): StructuredIntent {
    for (const { pattern, action, extract } of NL_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        return {
          action,
          params: extract(match),
          source: IntentSource.NL,
        };
      }
    }

    return {
      action: 'unknown',
      params: { raw: text },
      source: IntentSource.NL,
    };
  }

  private _normalizeAction(action: string): string {
    const lower = action.toLowerCase().trim();
    const aliasMap: Record<string, string> = {
      'send': 'wallet_execute',
      'transfer': 'wallet_execute',
      'deploy_wallet': 'wallet_create',
      'new_wallet': 'wallet_create',
      'make_wallet': 'wallet_create',
      'new_session': 'session_create_lightweight',
      'start_session': 'session_create_lightweight',
      'kill_session': 'session_revoke',
      'end_session': 'session_revoke',
      'new_credential': 'credential_issue',
      'give_credential': 'credential_issue',
      'remove_credential': 'credential_revoke',
      'new_org': 'organization_register',
      'register_org': 'organization_register',
      'new_capability': 'capability_register',
      'new_delegation': 'delegation_create',
    };
    return aliasMap[lower] || lower;
  }

  private _errorIntent(message: string, action: string): ParsedIntent {
    return {
      version: 1,
      id: generateId(),
      source: IntentSource.NL,
      action,
      normalizedAction: action,
      params: {},
      requestedAt: Math.floor(Date.now() / 1000),
      priority: IntentPriority.NORMAL,
      validationErrors: [message],
    };
  }
}
