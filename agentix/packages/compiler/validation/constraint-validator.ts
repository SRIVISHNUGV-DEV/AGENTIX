export interface ConstraintCheckResult {
  valid: boolean;
  errors: string[];
}

export function validateValueLimit(value: string, maxValue: string): ConstraintCheckResult {
  const errors: string[] = [];
  try {
    const v = BigInt(value);
    const m = BigInt(maxValue);
    if (v > m) {
      errors.push(`Value ${value} exceeds maximum ${maxValue}`);
    }
  } catch {
    errors.push(`Invalid value format: ${value}`);
  }
  return { valid: errors.length === 0, errors };
}

export function validateExpiry(expiry: number): ConstraintCheckResult {
  const now = Math.floor(Date.now() / 1000);
  if (expiry <= now) {
    return { valid: false, errors: [`Expiry ${expiry} is in the past (current: ${now})`] };
  }
  if (expiry > now + 365 * 86400) {
    return { valid: false, errors: [`Expiry ${expiry} is more than 1 year in the future`] };
  }
  return { valid: true, errors: [] };
}

export function validateBatchSize(targets: unknown[], max: number = 20): ConstraintCheckResult {
  if (targets.length === 0) {
    return { valid: false, errors: ['Batch cannot be empty'] };
  }
  if (targets.length > max) {
    return { valid: false, errors: [`Batch size ${targets.length} exceeds maximum ${max}`] };
  }
  return { valid: true, errors: [] };
}

export function validateDailyLimit(currentUsed: string, requested: string, dailyLimit: string): ConstraintCheckResult {
  try {
    const used = BigInt(currentUsed);
    const req = BigInt(requested);
    const limit = BigInt(dailyLimit);
    if (used + req > limit) {
      return {
        valid: false,
        errors: [`Daily spend limit exceeded: used=${used}, requested=${req}, limit=${limit}`],
      };
    }
  } catch {
    return { valid: false, errors: ['Invalid numeric values in daily limit check'] };
  }
  return { valid: true, errors: [] };
}

export function validateTargetAllowed(target: string, allowedTargets: string[]): ConstraintCheckResult {
  if (allowedTargets.length === 0) return { valid: true, errors: [] };
  const lower = target.toLowerCase();
  const allowed = allowedTargets.some((t) => t.toLowerCase() === lower);
  if (!allowed) {
    return { valid: false, errors: [`Target ${target} is not in the allowed list`] };
  }
  return { valid: true, errors: [] };
}

export function validatePermissionsRequired(required: number, granted: number): ConstraintCheckResult {
  if ((granted & required) !== required) {
    const missing = required & ~granted;
    return {
      valid: false,
      errors: [`Missing required permissions: 0x${missing.toString(16)} (required: 0x${required.toString(16)}, granted: 0x${granted.toString(16)})`],
    };
  }
  return { valid: true, errors: [] };
}
