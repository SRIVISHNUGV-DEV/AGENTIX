import { ParsedIntent } from '../types/intent';
import { validateIntent } from '../validation/schemas';
import {
  checkIdentityActive,
  checkWalletExists,
  checkOrganizationExists,
  checkSessionValid,
} from '../validation/identity-validator';
import { isValidAddress } from '../validation/address-validator';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class IntentValidator {
  /**
   * Validate a parsed intent: zod schema, identity/wallet/org/session existence, target addresses, expiry.
   * Why: stage 2 is the last cheap gate before capability resolution — everything here is local/DB, no chain calls.
   * @param intent - parsed intent; its validationErrors field is overwritten with the errors found here.
   * @param context - optional caller wallet/session ids used when the intent itself carries none.
   * @returns { valid, errors, warnings }: valid is false on any schema, identity, org, session, address or expiry error; a missing wallet row is a warning, not an error.
   * @throws Never for bad input; a DB failure surfaces as an error only if a check throws — callers must treat a false valid as the signal.
   * Security note: this validates shape and existence only — it is not an authorization check; capability/policy stages still gate execution.
   * Maps to: internal — PipelineOrchestrator.compile (stage 2).
   */
  validate(intent: ParsedIntent, context?: { walletAddress?: string; sessionId?: string }): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const schemaResult = validateIntent(intent.normalizedAction, intent.params);
    if (!schemaResult.valid) {
      errors.push(...schemaResult.errors);
    }

    if (intent.agent) {
      if (intent.agent.identityId) {
        const identityCheck = checkIdentityActive(intent.agent.identityId);
        if (!identityCheck.valid) {
          errors.push(identityCheck.error!);
        }
      }

      if (intent.agent.walletAddress) {
        if (!isValidAddress(intent.agent.walletAddress)) {
          errors.push(`Invalid agent wallet address: ${intent.agent.walletAddress}`);
        } else {
          const walletCheck = checkWalletExists(intent.agent.walletAddress);
          if (!walletCheck.valid) {
            warnings.push(walletCheck.error!);
          }
        }
      }
    }

    if (intent.organizationId) {
      const orgCheck = checkOrganizationExists(intent.organizationId);
      if (!orgCheck.valid) {
        errors.push(orgCheck.error!);
      } else if (orgCheck.active === false) {
        errors.push(`Organization ${intent.organizationId} is inactive`);
      }
    }

    const sessionId = intent.sessionId || context?.sessionId;
    if (sessionId) {
      const sessionCheck = checkSessionValid(sessionId);
      if (!sessionCheck.valid) {
        errors.push(sessionCheck.error!);
      }
    }

    const targetAddresses = this._extractTargets(intent);
    for (const addr of targetAddresses) {
      if (!isValidAddress(addr)) {
        errors.push(`Invalid target address: ${addr}`);
      }
    }

    if (intent.limits?.expiry) {
      const now = Math.floor(Date.now() / 1000);
      if (intent.limits.expiry <= now) {
        errors.push(`Expiry ${intent.limits.expiry} is in the past`);
      }
    }

    intent.validationErrors = errors;

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Collect every address the intent could touch, de-duplicated.
   * Why: validation must check all of them — targets hide in typed fields and in the loose params bag (target/targets/recipient/delegatee/ownerAddress/walletAddress).
   * @param intent - parsed intent.
   * @returns Unique address strings (unchecked format; callers validate each with isValidAddress).
   * Maps to: internal — IntentValidator.validate.
   */
  private _extractTargets(intent: ParsedIntent): string[] {
    const targets: string[] = [];

    if (intent.targets) {
      targets.push(...intent.targets);
    }

    const params = intent.params;
    if (typeof params.target === 'string') targets.push(params.target);
    if (Array.isArray(params.targets)) targets.push(...params.targets.filter((t: unknown): t is string => typeof t === 'string'));
    if (typeof params.recipient === 'string') targets.push(params.recipient);
    if (typeof params.delegatee === 'string') targets.push(params.delegatee);
    if (typeof params.ownerAddress === 'string') targets.push(params.ownerAddress);
    if (typeof params.walletAddress === 'string') targets.push(params.walletAddress);

    return [...new Set(targets)];
  }
}
