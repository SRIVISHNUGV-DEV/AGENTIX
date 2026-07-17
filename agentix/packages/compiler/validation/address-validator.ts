const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export function isValidAddress(address: unknown): address is string {
  return typeof address === 'string' && ADDRESS_REGEX.test(address);
}

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

export function isKnownImplementation(address: string): boolean {
  return IMPLEMENTATION_ADDRESSES.has(address.toLowerCase());
}

export function registerImplementation(address: string): void {
  IMPLEMENTATION_ADDRESSES.add(address.toLowerCase());
}

const PROXY_ADDRESSES = new Map<string, string>();

export function isKnownProxy(address: string): boolean {
  return PROXY_ADDRESSES.has(address.toLowerCase());
}

export function getProxyForImplementation(address: string): string | undefined {
  return PROXY_ADDRESSES.get(address.toLowerCase());
}

export function registerProxy(proxyAddress: string, implementationAddress: string): void {
  PROXY_ADDRESSES.set(implementationAddress.toLowerCase(), proxyAddress.toLowerCase());
}
