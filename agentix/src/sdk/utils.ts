import { ethers } from 'ethers';
import { ValidationError } from './errors';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function isAddress(addr: string): boolean {
  return ethers.isAddress(addr);
}

export function assertAddress(addr: string, label: string): void {
  if (!addr || addr === ZERO_ADDRESS) throw new ValidationError(label + ' cannot be zero/empty');
  if (!ethers.isAddress(addr)) throw new ValidationError(label + ' is not a valid address: ' + addr);
}

export function assertNonZero(bytes32: string, label: string): void {
  if (!bytes32 || bytes32 === ethers.ZeroHash) throw new ValidationError(label + ' cannot be zero');
}

export function assertInFuture(timestamp: number, label: string): void {
  if (timestamp <= Math.floor(Date.now() / 1000)) throw new ValidationError(label + ' must be in the future');
}

export function assertArrayLength(arr: unknown[], min: number, max: number, label: string): void {
  if (arr.length < min) throw new ValidationError(label + ' must have at least ' + min + ' items');
  if (arr.length > max) throw new ValidationError(label + ' must have at most ' + max + ' items');
}

export function computeSessionId(
  wallet: string,
  sessionKey: string,
  expiry: number,
  salt: string
): string {
  return ethers.solidityPackedKeccak256(
    ['address', 'address', 'uint64', 'bytes32'],
    [wallet, sessionKey, expiry, salt]
  );
}

export function computeDelegationLeaf(
  delegator: string,
  delegate: string,
  scopeHash: string,
  expiresAt: number
): string {
  return ethers.solidityPackedKeccak256(
    ['address', 'address', 'bytes32', 'uint64'],
    [delegator, delegate, scopeHash, expiresAt]
  );
}

export function hashMetadata(metadata: Record<string, unknown>): string {
  const str = JSON.stringify(metadata, Object.keys(metadata).sort());
  return ethers.solidityPackedKeccak256(['string'], [str]);
}
