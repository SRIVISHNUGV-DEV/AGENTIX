import { StructuredIntent, ParsedIntent, IntentIR, NL_PATTERNS, IntentSource, IntentPriority } from '../types/intent';
import { CompilerConfig } from '../types/compilation';
import { generateId } from '@agentix/utils';

/**
 * The canonical action-alias map. One source of truth: the gateway, the
 * compiler, and every enforcement check MUST resolve an incoming action
 * through this function before gating on it. Gating on a pre-normalisation
 * string is a bypass (R-1): `new_capability` is `capability_register` after
 * normalisation, and an owner-only check on the raw spelling misses it.
 */
export const ACTION_ALIASES: Record<string, string> = {
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

/** Lowercase, trim, and alias-map an action to its canonical gateway name.
 * Why: every enforcement check gates on the normalized name; gating on a raw
 * spelling is a bypass (e.g. `new_capability` must read as `capability_register`).
 * @param action - raw action string from the caller; case and whitespace are ignored.
 * @returns The canonical action name, or the lowercased input when it has no alias.
 * Maps to: internal — IntentParser._normalizeAction (and every gateway enforcement check).
 */
export function normalizeAction(action: string): string {
  const lower = action.toLowerCase().trim();
  return ACTION_ALIASES[lower] || lower;
}

export class IntentParser {
  /**
   * Build the stage-1 parser.
   * Why: natural-language parsing is config-gated — the parser must know whether NL input is allowed before it sees any.
   * @param config - compiler config; naturalLanguageEnabled decides whether string input is parsed or rejected.
   * Maps to: internal — PipelineOrchestrator constructor.
   */
  constructor(private config: CompilerConfig) {}

  /**
   * Turn a structured intent or free text into a normalized ParsedIntent.
   * Why: stage 1 is the pipeline's front door — every later stage trusts the normalized action and the idempotency key set here.
   * @param input - structured intent, or free text when naturalLanguageEnabled (otherwise an error intent).
   * @returns ParsedIntent with normalized action, generated id, and empty validationErrors; on NL-disabled string input or unmatched text, an error intent with validationErrors set.
   * Side effects: none on storage; assigns a fresh id and requestedAt timestamp.
   * Maps to: MCP tool agentix_compile_intent (structured path) / agentix_parse_intent (NL path).
   */
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

  /**
   * Match free text against the regex NL_PATTERNS table, first match wins.
   * Why: the offline fallback when no LLM classifier is in the loop — deterministic and dependency-free.
   * @param text - raw user text.
   * @returns The first matching pattern's structured intent, or an 'unknown' action carrying the raw text when nothing matches.
   * Maps to: internal — IntentParser.parse.
   */
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

  /**
   * Normalize one action name through the canonical alias map.
   * Why: thin wrapper so the parser never calls the module function directly — keeps aliasing behind the class boundary.
   * @param action - raw action string.
   * @returns Canonical action name.
   * Maps to: internal — normalizeAction (module function).
   */
  private _normalizeAction(action: string): string {
    return normalizeAction(action);
  }

  /**
   * Build a ParsedIntent that carries only an error, for inputs that cannot be parsed.
   * Why: the pipeline's error contract is "return an intent with validationErrors", not throw — the orchestrator turns this into a REJECTED plan.
   * @param message - error text placed in validationErrors.
   * @param action - the action string that failed (often 'unknown').
   * @returns A ParsedIntent with empty params and the error recorded.
   * Maps to: internal — IntentParser.parse.
   */
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
