export interface ConstraintCheckResult {
  valid: boolean;
  errors: string[];
}

/**
 * Check a wei value against a max (both decimal strings, compared as BigInt).
 * Why: the reusable "does this transfer fit the ceiling" check — used wherever a limit is enforced outside the policy graph.
 * @param value - value to check; unparseable strings fail validation.
 * @param maxValue - ceiling; unparseable strings fail validation.
 * @returns { valid, errors }: valid false with an error when value > maxValue or either side is not a valid integer string.
 * Maps to: policy rule spend-cap.
 */
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

/**
 * Check an expiry timestamp: must be in the future and at most 1 year out.
 * Why: an expired intent is a replay risk and a >1y expiry is almost certainly a units mistake (ms instead of seconds) — both are rejected here.
 * @param expiry - unix seconds.
 * @returns { valid, errors }: valid false when expiry <= now or > now + 365 days.
 * Maps to: policy rule spend-cap (time limit).
 */
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

/**
 * Check a batch is non-empty and within the size cap.
 * Why: empty batches are meaningless and oversized batches blow the gas/policy envelope — the 20 cap matches the policy default.
 * @param targets - batch entries (only the length is inspected).
 * @param max - maximum batch size; defaults to 20.
 * @returns { valid, errors }: valid false when empty or longer than max.
 * Maps to: policy rule spend-cap (maxBatchSize).
 */
export function validateBatchSize(targets: unknown[], max: number = 20): ConstraintCheckResult {
  if (targets.length === 0) {
    return { valid: false, errors: ['Batch cannot be empty'] };
  }
  if (targets.length > max) {
    return { valid: false, errors: [`Batch size ${targets.length} exceeds maximum ${max}`] };
  }
  return { valid: true, errors: [] };
}

/**
 * Check used + requested stays within a daily spend limit (all decimal wei strings, BigInt math).
 * Why: daily limits are cumulative — a single request under the cap can still breach it when combined with today's spend.
 * @param currentUsed - already spent today, wei.
 * @param requested - this request's value, wei.
 * @param dailyLimit - daily cap, wei; any unparseable side fails validation.
 * @returns { valid, errors }: valid false with the used/requested/limit figures when the sum exceeds the cap.
 * Maps to: policy rule spend-cap (daily limit).
 */
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

/**
 * Check a target is on the allowlist (case-insensitive); an empty allowlist allows everything.
 * Why: allowlists are opt-in — no list means no restriction, which is the documented default, not a bug.
 * @param target - target address.
 * @param allowedTargets - allowlist; empty means unrestricted.
 * @returns { valid, errors }: valid false with an error when the list is non-empty and the target is absent.
 * Maps to: policy rule spend-cap (target allowlist).
 */
export function validateTargetAllowed(target: string, allowedTargets: string[]): ConstraintCheckResult {
  if (allowedTargets.length === 0) return { valid: true, errors: [] };
  const lower = target.toLowerCase();
  const allowed = allowedTargets.some((t) => t.toLowerCase() === lower);
  if (!allowed) {
    return { valid: false, errors: [`Target ${target} is not in the allowed list`] };
  }
  return { valid: true, errors: [] };
}

/**
 * Check a permission bitmask covers the required bits.
 * Why: permissions are bit flags — a subset check, not an equality check, is the correct test.
 * @param required - required permission bits.
 * @param granted - granted permission bits.
 * @returns { valid, errors }: valid false naming the missing bits in hex (required & ~granted) when any required bit is absent.
 * Maps to: contract CredentialRegistry (permission bits).
 */
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
