const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

/**
 * Test whether a value is a well-formed Ethereum address (0x + 40 hex chars).
 * Why: the cheapest gate in the codebase — every address check in validation, risk and contract resolution starts here.
 * @param address - any value; non-strings are false, not an error.
 * @returns True only for 0x-prefixed 40-hex-char strings (checksum not checked — see isChecksummed).
 * Maps to: contract address validation for every action's address params.
 */
export function isValidAddress(address: unknown): address is string {
  return typeof address === 'string' && ADDRESS_REGEX.test(address);
}

/**
 * Test whether an address uses correct EIP-55 mixed-case checksum encoding.
 * Why: a well-formed but wrongly-cased address is usually a typo or a copy error — checksum validation catches it before it reaches the chain.
 * @param address - address string; malformed addresses return false.
 * @returns True when the casing matches the keccak256 hash of the lowercase address.
 * Maps to: internal — validateAddress callers that need checksum assurance.
 */
export function isChecksummed(address: string): boolean {
  if (!isValidAddress(address)) return false;
  const { keccak256, getBytes } = require('ethers');
  const clean = address.slice(2).toLowerCase();
  const hash = keccak256(getBytes('0x' + clean)).slice(2);
  for (let i = 0; i < 40; i++) {
    const charCode = address.charCodeAt(i + 2);
    const hashNibble = parseInt(hash[i], 16);
    if (charCode >= 65 && charCode <= 70 && hashNibble <= 7) return false;
    if (charCode >= 97 && charCode <= 102 && hashNibble > 7) return false;
  }
  return true;
}

/**
 * Validate an address with a human-readable error: required, well-formed, and not the zero address.
 * Why: stage-2 error messages must say which field failed and why — a bare boolean cannot do that.
 * @param address - value to check.
 * @param fieldName - field name used in the error message; defaults to 'address'.
 * @returns { valid, error }: valid false with an error message on missing/non-string, malformed, or zero address; valid true with no error otherwise.
 * Maps to: internal — IntentValidator.validate (target address checks).
 */
export function validateAddress(address: unknown, fieldName: string = 'address'): { valid: boolean; error?: string } {
  if (!address || typeof address !== 'string') {
    return { valid: false, error: `${fieldName} is required and must be a string` };
  }
  if (!ADDRESS_REGEX.test(address)) {
    return { valid: false, error: `${fieldName} must be a valid Ethereum address (0x + 40 hex chars)` };
  }
  if (address === '0x0000000000000000000000000000000000000000') {
    return { valid: false, error: `${fieldName} cannot be the zero address` };
  }
  return { valid: true };
}

const IMPLEMENTATION_ADDRESSES = new Set<string>();

/**
 * Test whether an address is a registered implementation contract.
 * Why: proxy/implementation bookkeeping for upgrade checks — callers ask "is this address a known implementation" without touching the registry map directly.
 * @param address - address (case-insensitive).
 * @returns True when registered via registerImplementation; false otherwise (the set starts empty).
 * Maps to: internal — proxy/implementation registry.
 */
export function isKnownImplementation(address: string): boolean {
  return IMPLEMENTATION_ADDRESSES.has(address.toLowerCase());
}

/**
 * Register an implementation contract address (in-memory only).
 * Why: the known-implementation set is populated at runtime by whoever knows the deployment — there is no on-disk source.
 * @param address - address to register; lowercased on store.
 * Side effects: mutates the module-level IMPLEMENTATION_ADDRESSES set; nothing is persisted.
 * Maps to: internal — isKnownImplementation.
 */
export function registerImplementation(address: string): void {
  IMPLEMENTATION_ADDRESSES.add(address.toLowerCase());
}

const PROXY_ADDRESSES = new Map<string, string>();

/**
 * Test whether an address is a registered proxy (stored as a value, keyed by implementation).
 * Why: the reverse lookup — "does this address act as a proxy for some implementation".
 * @param address - address (case-insensitive).
 * @returns True when some implementation maps to it via registerProxy.
 * Maps to: internal — getProxyForImplementation.
 */
export function isKnownProxy(address: string): boolean {
  return PROXY_ADDRESSES.has(address.toLowerCase());
}

/**
 * Return the proxy address registered for an implementation.
 * Why: upgrade tooling resolves implementation → proxy through this single lookup.
 * @param address - implementation address (case-insensitive).
 * @returns The proxy address, or undefined when none is registered.
 * Maps to: internal — registerProxy.
 */
export function getProxyForImplementation(address: string): string | undefined {
  return PROXY_ADDRESSES.get(address.toLowerCase());
}

/**
 * Register a proxy → implementation pairing (in-memory only).
 * Why: the pairing is deployment knowledge supplied at runtime; note the map is keyed by implementation, so one implementation holds at most one proxy.
 * @param proxyAddress - proxy address; lowercased on store.
 * @param implementationAddress - implementation address; lowercased, used as the key.
 * Side effects: mutates the module-level PROXY_ADDRESSES map; nothing is persisted.
 * Maps to: internal — isKnownProxy / getProxyForImplementation.
 */
export function registerProxy(proxyAddress: string, implementationAddress: string): void {
  PROXY_ADDRESSES.set(implementationAddress.toLowerCase(), proxyAddress.toLowerCase());
}
