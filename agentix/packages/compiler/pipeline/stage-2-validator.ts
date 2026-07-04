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
