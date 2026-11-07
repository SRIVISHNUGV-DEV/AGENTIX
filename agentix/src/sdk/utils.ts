import { ethers } from 'ethers';
import { ValidationError } from './errors';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Returns whether a string is a well-formed Ethereum address (checksummed or not).
 * Use for cheap validation of user-supplied addresses before any RPC call.
 * @returns True for any valid address; false for garbage, zero address is valid here.
 * Maps to: internal — assertAddress and every SDK module that takes an address.
 */
export function isAddress(addr: string): boolean {
  return ethers.isAddress(addr);
}

/**
 * Rejects an empty, zero, or malformed address before it reaches a contract call.
 * Call at the top of every method that takes an address so failures are local, not reverts.
 * @param label - Field name used in the error message.
 * @throws ValidationError on empty, zero, or non-address input.
 * Maps to: internal — every SDK module method that takes an address.
 */
export function assertAddress(addr: string, label: string): void {
  if (!addr || addr === ZERO_ADDRESS) throw new ValidationError(label + ' cannot be zero/empty');
  if (!ethers.isAddress(addr)) throw new ValidationError(label + ' is not a valid address: ' + addr);
}

/**
 * Rejects an empty or all-zero bytes32 value (session id, root, leaf hash).
 * Zero is the contract's "unset" sentinel, so passing it through would silently match nothing or revert.
 * @throws ValidationError on empty input or the zero hash.
 * Maps to: internal — every SDK module method that takes a bytes32 id or root.
 */
export function assertNonZero(bytes32: string, label: string): void {
  if (!bytes32 || bytes32 === ethers.ZeroHash) throw new ValidationError(label + ' cannot be zero');
}

/**
 * Rejects a Unix timestamp that is not strictly in the future.
 * Session expiry must be future-dated or the contract rejects creation (InvalidExpiry).
 * @param timestamp - Unix seconds; compared against the local clock, so clock skew can false-positive.
 * @throws ValidationError when the timestamp is at or before now.
 * Maps to: contract SessionManager.createSession / createLightweightSession (expiry).
 */
export function assertInFuture(timestamp: number, label: string): void {
  if (timestamp <= Math.floor(Date.now() / 1000)) throw new ValidationError(label + ' must be in the future');
}

/**
 * Rejects an array outside the [min, max] length the contract accepts.
 * Guards batch calls against empty batches and over-limit batches before gas is spent.
 * @throws ValidationError when the array is too short or too long.
 * Maps to: contract AgentWallet.executeBatch (1-20 targets).
 */
export function assertArrayLength(arr: unknown[], min: number, max: number, label: string): void {
  if (arr.length < min) throw new ValidationError(label + ' must have at least ' + min + ' items');
  if (arr.length > max) throw new ValidationError(label + ' must have at most ' + max + ' items');
}

/**
 * Derives the deterministic session id from (wallet, sessionKey, expiry, salt).
 * Callers must use this exact packing so the id matches what SessionManager stores.
 * @param expiry - Unix seconds; @param salt - bytes32 uniqueness salt.
 * @returns The keccak256 id as a 0x hex string.
 * Maps to: contract SessionManager.createSession (sessionId).
 */
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

/**
 * Derives the delegation leaf hash from (delegator, delegate, scopeHash, expiresAt).
 * The leaf is the unit that gets Merkle-proven and revoked, so the packing must match the contract's.
 * @param expiresAt - Unix seconds; @param scopeHash - keccak256 of the scope action string.
 * @returns The keccak256 leaf hash as a 0x hex string.
 * Maps to: contract DelegationManager.verifyDelegation (delegationLeaf).
 */
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

/**
 * Hashes a metadata object deterministically (keys sorted before stringifying).
 * Used where only a commitment to metadata goes on-chain, so equal objects must hash equal regardless of key order.
 * @returns The keccak256 of the canonical JSON as a 0x hex string.
 * Maps to: internal — identity metadata roots (AgentIdentity.updateMetadata).
 */
export function hashMetadata(metadata: Record<string, unknown>): string {
  const str = JSON.stringify(metadata, Object.keys(metadata).sort());
  return ethers.solidityPackedKeccak256(['string'], [str]);
}
