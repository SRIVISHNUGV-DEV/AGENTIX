export class SignerRequiredError extends Error {
  constructor(operation: string) {
    super('Signer required for "' + operation + '". Pass an ethers.Signer (wallet, JsonRpcSigner, etc.) to the AgentIX constructor. AgentIX never asks for private keys.');
    this.name = 'SignerRequiredError';
  }
}

export class NotOwnerError extends Error {
  constructor() { super('Caller is not the wallet owner'); this.name = 'NotOwnerError'; }
}
export class NotEntryPointError extends Error {
  constructor() { super('Caller is not the EntryPoint'); this.name = 'NotEntryPointError'; }
}
export class NotAuthorizedError extends Error {
  constructor() { super('Caller is not authorized'); this.name = 'NotAuthorizedError'; }
}
export class AlreadyInitializedError extends Error {
  constructor() { super('Wallet already initialized'); this.name = 'AlreadyInitializedError'; }
}
export class NotInitializedError extends Error {
  constructor() { super('Wallet not initialized'); this.name = 'NotInitializedError'; }
}
export class InvalidOwnerError extends Error {
  constructor() { super('Invalid owner address (zero)'); this.name = 'InvalidOwnerError'; }
}
export class ExecutionFailedError extends Error {
  constructor() { super('Wallet execution reverted'); this.name = 'ExecutionFailedError'; }
}
export class CallFailedError extends Error {
  constructor() { super('Batch call reverted'); this.name = 'CallFailedError'; }
}
export class BatchTooLargeError extends Error {
  constructor(public max: number) { super('Batch exceeds max size ' + max); this.name = 'BatchTooLargeError'; }
}
export class OwnershipTransferPendingError extends Error {
  constructor() { super('Ownership transfer already pending'); this.name = 'OwnershipTransferPendingError'; }
}
export class InvalidOwnerSignatureError extends Error {
  constructor() { super('Owner signature is invalid'); this.name = 'InvalidOwnerSignatureError'; }
}
export class BatchNotAllowedForSessionError extends Error {
  constructor() { super('Batch execution not allowed via sessions'); this.name = 'BatchNotAllowedForSessionError'; }
}
export class UnsupportedCallDataError extends Error {
  constructor() { super('Unsupported calldata format'); this.name = 'UnsupportedCallDataError'; }
}
export class SessionNotFoundError extends Error {
  constructor() { super('Session does not exist'); this.name = 'SessionNotFoundError'; }
}
export class SessionExpiredError extends Error {
  constructor() { super('Session has expired'); this.name = 'SessionExpiredError'; }
}
export class SessionRevokedError extends Error {
  constructor() { super('Session has been revoked'); this.name = 'SessionRevokedError'; }
}
export class SessionAlreadyExistsError extends Error {
  constructor() { super('Session ID already in use'); this.name = 'SessionAlreadyExistsError'; }
}
export class NotWalletOwnerError extends Error {
  constructor() { super('Signer is not the wallet owner'); this.name = 'NotWalletOwnerError'; }
}
export class LimitExceededError extends Error {
  constructor() { super('Session spend limit exceeded'); this.name = 'LimitExceededError'; }
}
export class DailySpendLimitExceededError extends Error {
  constructor() { super('Daily spend limit exceeded'); this.name = 'DailySpendLimitExceededError'; }
}
export class DailyTxLimitExceededError extends Error {
  constructor() { super('Daily transaction limit exceeded'); this.name = 'DailyTxLimitExceededError'; }
}
export class InvalidExpiryError extends Error {
  constructor() { super('Session expiry is invalid (must be in the future)'); this.name = 'InvalidExpiryError'; }
}
export class TooManySessionsError extends Error {
  constructor(public max: number) { super('Max ' + max + ' sessions per wallet reached'); this.name = 'TooManySessionsError'; }
}
export class InvalidProofError extends Error {
  constructor() { super('ZK proof verification failed'); this.name = 'InvalidProofError'; }
}
export class NotAgentWalletError extends Error {
  constructor() { super('Address is not an AgentWallet'); this.name = 'NotAgentWalletError'; }
}
export class InvalidImplementationError extends Error {
  constructor() { super('Invalid wallet implementation address'); this.name = 'InvalidImplementationError'; }
}
export class WalletAlreadyExistsWithDifferentOwnerError extends Error {
  constructor() { super('Wallet at this address belongs to a different owner'); this.name = 'WalletAlreadyExistsWithDifferentOwnerError'; }
}
export class IdentityNotFoundError extends Error {
  constructor() { super('Identity does not exist'); this.name = 'IdentityNotFoundError'; }
}
export class IdentityInactiveError extends Error {
  constructor() { super('Identity is inactive'); this.name = 'IdentityInactiveError'; }
}
export class IdentityAlreadyRegisteredError extends Error {
  constructor() { super('Wallet already has an identity'); this.name = 'IdentityAlreadyRegisteredError'; }
}
export class NotIdentityOwnerError extends Error {
  constructor() { super('Not the identity owner'); this.name = 'NotIdentityOwnerError'; }
}
export class InvalidMetadataRootError extends Error {
  constructor() { super('Metadata root cannot be zero'); this.name = 'InvalidMetadataRootError'; }
}
export class MetadataRootUnchangedError extends Error {
  constructor() { super('New metadata root matches existing'); this.name = 'MetadataRootUnchangedError'; }
}
export class OnlyIssuerError extends Error {
  constructor() { super('Caller is not an authorized issuer'); this.name = 'OnlyIssuerError'; }
}
export class NullifierUsedError extends Error {
  constructor() { super('Nullifier has already been used'); this.name = 'NullifierUsedError'; }
}
export class RootCannotBeZeroError extends Error {
  constructor() { super('Root cannot be zero'); this.name = 'RootCannotBeZeroError'; }
}
export class OrganizationNotFoundError extends Error {
  constructor() { super('Organization does not exist'); this.name = 'OrganizationNotFoundError'; }
}
export class OrganizationAlreadyExistsError extends Error {
  constructor() { super('Organization ID already in use'); this.name = 'OrganizationAlreadyExistsError'; }
}
export class OrganizationInactiveError extends Error {
  constructor() { super('Organization is inactive'); this.name = 'OrganizationInactiveError'; }
}
export class CapabilityNotFoundError extends Error {
  constructor() { super('Capability does not exist'); this.name = 'CapabilityNotFoundError'; }
}
export class CapabilityAlreadyExistsError extends Error {
  constructor() { super('Capability ID already in use'); this.name = 'CapabilityAlreadyExistsError'; }
}
export class NotAuthorizedForCapabilityError extends Error {
  constructor() { super('Not authorized to manage this capability'); this.name = 'NotAuthorizedForCapabilityError'; }
}
export class GrantNotRevocableError extends Error {
  constructor() { super('Grant cannot be revoked by caller'); this.name = 'GrantNotRevocableError'; }
}
export class DelegatorRevokedError extends Error {
  constructor() { super('Delegator has been revoked'); this.name = 'DelegatorRevokedError'; }
}
export class AlreadyRevokedDelegationError extends Error {
  constructor() { super('Delegation leaf already revoked'); this.name = 'AlreadyRevokedDelegationError'; }
}
export class TimelockNotReadyError extends Error {
  constructor() { super('Timelock period has not elapsed'); this.name = 'TimelockNotReadyError'; }
}
export class TimelockActiveError extends Error {
  constructor() { super('A pending change already exists'); this.name = 'TimelockActiveError'; }
}
// ----- Identity errors -----
export class IdentityAlreadyActiveError extends Error {
  constructor() { super('Identity is already active'); this.name = 'IdentityAlreadyActiveError'; }
}
export class InvalidIdentityIdError extends Error {
  constructor() { super('Invalid identity ID'); this.name = 'InvalidIdentityIdError'; }
}
export class NotFactoryError extends Error {
  constructor() { super('Caller is not the factory'); this.name = 'NotFactoryError'; }
}
export class ZeroAddressNotAllowedError extends Error {
  constructor() { super('Zero address not allowed'); this.name = 'ZeroAddressNotAllowedError'; }
}

// ----- Wallet errors -----
export class InvalidSessionManagerError extends Error {
  constructor() { super('Invalid session manager address'); this.name = 'InvalidSessionManagerError'; }
}
export class InvalidEntryPointError extends Error {
  constructor() { super('Invalid entry point address'); this.name = 'InvalidEntryPointError'; }
}
export class LengthMismatchError extends Error {
  constructor() { super('Array length mismatch'); this.name = 'LengthMismatchError'; }
}
export class InvalidRecipientError extends Error {
  constructor() { super('Invalid recipient address'); this.name = 'InvalidRecipientError'; }
}
export class FundingFailedError extends Error {
  constructor() { super('Wallet funding failed'); this.name = 'FundingFailedError'; }
}
export class InvalidCallDataError extends Error {
  constructor() { super('Invalid calldata'); this.name = 'InvalidCallDataError'; }
}
export class LightweightSessionValidationFailedError extends Error {
  constructor() { super('Lightweight session validation failed'); this.name = 'LightweightSessionValidationFailedError'; }
}
export class SessionValidationFailedError extends Error {
  constructor() { super('ZK session validation failed'); this.name = 'SessionValidationFailedError'; }
}

// ----- Factory errors -----
export class FactoryInvalidSessionManagerError extends Error {
  constructor() { super('Factory: invalid session manager address'); this.name = 'FactoryInvalidSessionManagerError'; }
}
export class FactoryInvalidEntryPointError extends Error {
  constructor() { super('Factory: invalid entry point address'); this.name = 'FactoryInvalidEntryPointError'; }
}
export class FactoryInvalidOwnerError extends Error {
  constructor() { super('Factory: invalid owner address'); this.name = 'FactoryInvalidOwnerError'; }
}
export class FactoryTimelockNotReadyError extends Error {
  constructor() { super('Factory: timelock period has not elapsed'); this.name = 'FactoryTimelockNotReadyError'; }
}
export class FactoryTimelockActiveError extends Error {
  constructor() { super('Factory: a pending change already exists'); this.name = 'FactoryTimelockActiveError'; }
}
export class InvalidAgentIdentityError extends Error {
  constructor() { super('Invalid agent identity address'); this.name = 'InvalidAgentIdentityError'; }
}

// ----- Credential Registry errors -----
export class OnlySessionManagerError extends Error {
  constructor() { super('Caller is not an authorized session manager'); this.name = 'OnlySessionManagerError'; }
}

// ----- Capability Registry errors -----
export class ActionRequiredError extends Error {
  constructor() { super('Action string is required'); this.name = 'ActionRequiredError'; }
}
export class AlreadyRevokedCapabilityError extends Error {
  constructor() { super('Capability already revoked'); this.name = 'AlreadyRevokedCapabilityError'; }
}
export class AlreadyRevokedGrantError extends Error {
  constructor() { super('Grant already revoked'); this.name = 'AlreadyRevokedGrantError'; }
}
export class InvalidGrantRootError extends Error {
  constructor() { super('Invalid grant root'); this.name = 'InvalidGrantRootError'; }
}

// ----- Delegation errors -----
export class EmptyChainError extends Error {
  constructor() { super('Delegation chain is empty'); this.name = 'EmptyChainError'; }
}
export class ChainTooLongError extends Error {
  constructor() { super('Delegation chain exceeds max depth'); this.name = 'ChainTooLongError'; }
}
export class ArrayLengthMismatchError extends Error {
  constructor() { super('Array length mismatch'); this.name = 'ArrayLengthMismatchError'; }
}
export class ScopeAlreadyRegisteredError extends Error {
  constructor() { super('Scope action already registered'); this.name = 'ScopeAlreadyRegisteredError'; }
}
export class ScopeLimitExceededError extends Error {
  constructor() { super('Scope limit exceeded'); this.name = 'ScopeLimitExceededError'; }
}

// ----- Organization errors -----
export class InvalidOwnerAddressError extends Error {
  constructor() { super('Invalid owner address'); this.name = 'InvalidOwnerAddressError'; }
}
export class InvalidNameError extends Error {
  constructor() { super('Invalid organization name'); this.name = 'InvalidNameError'; }
}
export class InvalidAnchorError extends Error {
  constructor() { super('Invalid credential anchor address'); this.name = 'InvalidAnchorError'; }
}
export class OrganizationAlreadyInactiveError extends Error {
  constructor() { super('Organization is already inactive'); this.name = 'OrganizationAlreadyInactiveError'; }
}
export class OrganizationAlreadyActiveError extends Error {
  constructor() { super('Organization is already active'); this.name = 'OrganizationAlreadyActiveError'; }
}
export class AnchorTimelockNotReadyError extends Error {
  constructor() { super('Anchor timelock period has not elapsed'); this.name = 'AnchorTimelockNotReadyError'; }
}
export class AnchorTimelockActiveError extends Error {
  constructor() { super('An anchor change is already pending'); this.name = 'AnchorTimelockActiveError'; }
}

// ----- Credential Anchor errors -----
export class InvalidOrganizationIdError extends Error {
  constructor() { super('Invalid organization ID'); this.name = 'InvalidOrganizationIdError'; }
}
export class RootAlreadyCurrentError extends Error {
  constructor() { super('Root is already the current root'); this.name = 'RootAlreadyCurrentError'; }
}
export class UnauthorizedUpdateError extends Error {
  constructor() { super('Caller is not authorized to update'); this.name = 'UnauthorizedUpdateError'; }
}
export class RevokedRootCannotBeZeroError extends Error {
  constructor() { super('Revoked root cannot be zero'); this.name = 'RevokedRootCannotBeZeroError'; }
}

// ----- Session errors -----
export class InvalidSessionKeyError extends Error {
  constructor() { super('Invalid session key address'); this.name = 'InvalidSessionKeyError'; }
}
export class NullifierMismatchError extends Error {
  constructor() { super('Nullifier mismatch in session proof'); this.name = 'NullifierMismatchError'; }
}
export class RootMismatchError extends Error {
  constructor() { super('Credential root mismatch'); this.name = 'RootMismatchError'; }
}
export class RevokedRootMismatchError extends Error {
  constructor() { super('Revoked credential root mismatch'); this.name = 'RevokedRootMismatchError'; }
}
export class MaxValueMismatchError extends Error {
  constructor() { super('Max value mismatch'); this.name = 'MaxValueMismatchError'; }
}
export class ExpiryMismatchError extends Error {
  constructor() { super('Expiry mismatch'); this.name = 'ExpiryMismatchError'; }
}
export class InvalidSignerError extends Error {
  constructor() { super('Invalid signer for session'); this.name = 'InvalidSignerError'; }
}
export class SessionAlreadyRevokedError extends Error {
  constructor() { super('Session is already revoked'); this.name = 'SessionAlreadyRevokedError'; }
}
export class NotAuthorizedToRevokeError extends Error {
  constructor() { super('Not authorized to revoke this session'); this.name = 'NotAuthorizedToRevokeError'; }
}
export class NotBoundWalletError extends Error {
  constructor() { super('Session is not bound to this wallet'); this.name = 'NotBoundWalletError'; }
}
export class UnsupportedCredentialVersionError extends Error {
  constructor() { super('Unsupported credential version'); this.name = 'UnsupportedCredentialVersionError'; }
}
export class WalletFactoryTimelockNotReadyError extends Error {
  constructor() { super('Wallet factory timelock not ready'); this.name = 'WalletFactoryTimelockNotReadyError'; }
}
export class WalletFactoryTimelockActiveError extends Error {
  constructor() { super('Wallet factory change already pending'); this.name = 'WalletFactoryTimelockActiveError'; }
}
export class InvalidNullifierError extends Error {
  constructor() { super('Invalid nullifier'); this.name = 'InvalidNullifierError'; }
}
export class TargetNotAllowedError extends Error {
  constructor() { super('Target not allowed in lightweight session'); this.name = 'TargetNotAllowedError'; }
}
export class TooManyTargetsError extends Error {
  constructor() { super('Too many targets for lightweight session'); this.name = 'TooManyTargetsError'; }
}

export class ConfigurationError extends Error {
  constructor(msg: string) { super(msg); this.name = 'ConfigurationError'; }
}
export class RpcError extends Error {
  constructor(msg: string, public cause?: unknown) { super(msg); this.name = 'RpcError'; }
}
export class ValidationError extends Error {
  constructor(msg: string) { super(msg); this.name = 'ValidationError'; }
}

const ERROR_MAP: Record<string, new (...args: never[]) => Error> = {
  NotOwnerError, NotEntryPointError, NotAuthorizedError,
  AlreadyInitializedError, NotInitializedError, InvalidOwnerError,
  ExecutionFailedError, CallFailedError, BatchTooLargeError,
  OwnershipTransferPendingError, InvalidOwnerSignatureError,
  BatchNotAllowedForSessionError, UnsupportedCallDataError,
  SessionNotFound: SessionNotFoundError,
  SessionExpired: SessionExpiredError,
  SessionIsRevoked: SessionRevokedError,
  SessionAlreadyExists: SessionAlreadyExistsError,
  NotWalletOwner: NotWalletOwnerError,
  LimitExceeded: LimitExceededError,
  DailySpendLimitExceeded: DailySpendLimitExceededError,
  DailyTxLimitExceeded: DailyTxLimitExceededError,
  InvalidExpiry: InvalidExpiryError,
  TooManySessions: TooManySessionsError,
  InvalidProof: InvalidProofError,
  NotAgentWallet: NotAgentWalletError,
  InvalidImplementationError,
  WalletAlreadyExistsWithDifferentOwner: WalletAlreadyExistsWithDifferentOwnerError,
  IdentityNotFound: IdentityNotFoundError,
  IdentityInactive: IdentityInactiveError,
  IdentityAlreadyRegistered: IdentityAlreadyRegisteredError,
  NotIdentityOwner: NotIdentityOwnerError,
  InvalidMetadataRoot: InvalidMetadataRootError,
  MetadataRootUnchanged: MetadataRootUnchangedError,
  OnlyIssuer: OnlyIssuerError,
  NullifierUsed: NullifierUsedError,
  NullifierAlreadyUsed: NullifierUsedError,
  RootCannotBeZero: RootCannotBeZeroError,
  OrganizationNotFound: OrganizationNotFoundError,
  OrganizationAlreadyExists: OrganizationAlreadyExistsError,
  OrganizationInactive: OrganizationInactiveError,
  CapabilityNotFound: CapabilityNotFoundError,
  CapabilityExists: CapabilityAlreadyExistsError,
  NotAuthorizedForCapability: NotAuthorizedForCapabilityError,
  GrantNotRevocable: GrantNotRevocableError,
  DelegatorHasBeenRevoked: DelegatorRevokedError,
  AlreadyRevokedDelegation: AlreadyRevokedDelegationError,
  TimelockNotReady: TimelockNotReadyError,
  TimelockActive: TimelockActiveError,
  // Identity
  IdentityAlreadyActive: IdentityAlreadyActiveError,
  InvalidIdentityId: InvalidIdentityIdError,
  NotFactory: NotFactoryError,
  ZeroAddressNotAllowed: ZeroAddressNotAllowedError,
  // Wallet
  InvalidSessionManagerError,
  InvalidEntryPointError,
  LengthMismatchError,
  InvalidRecipientError,
  FundingFailedError,
  InvalidCallDataError,
  LightweightSessionValidationFailedError,
  SessionValidationFailedError,
  // Factory
  FactoryInvalidSessionManagerError,
  FactoryInvalidEntryPointError,
  FactoryInvalidOwnerError,
  FactoryTimelockNotReadyError,
  FactoryTimelockActiveError,
  InvalidAgentIdentityError,
  // Credential Registry
  OnlySessionManager: OnlySessionManagerError,
  // Capability Registry
  ActionRequired: ActionRequiredError,
  AlreadyRevokedCapability: AlreadyRevokedCapabilityError,
  AlreadyRevokedGrant: AlreadyRevokedGrantError,
  InvalidRoot: InvalidGrantRootError,
  // Delegation
  EmptyChain: EmptyChainError,
  ChainTooLong: ChainTooLongError,
  ArrayLengthMismatch: ArrayLengthMismatchError,
  ScopeAlreadyRegistered: ScopeAlreadyRegisteredError,
  ScopeLimitExceeded: ScopeLimitExceededError,
  // Organization
  InvalidOwnerAddress: InvalidOwnerAddressError,
  InvalidName: InvalidNameError,
  InvalidAnchor: InvalidAnchorError,
  OrganizationAlreadyInactive: OrganizationAlreadyInactiveError,
  OrganizationAlreadyActive: OrganizationAlreadyActiveError,
  AnchorTimelockNotReady: AnchorTimelockNotReadyError,
  AnchorTimelockActive: AnchorTimelockActiveError,
  // Credential Anchor
  InvalidOrganizationId: InvalidOrganizationIdError,
  RootAlreadyCurrent: RootAlreadyCurrentError,
  UnauthorizedUpdate: UnauthorizedUpdateError,
  RevokedRootCannotBeZero: RevokedRootCannotBeZeroError,
  // Session
  InvalidSessionKey: InvalidSessionKeyError,
  NullifierMismatch: NullifierMismatchError,
  RootMismatch: RootMismatchError,
  RevokedRootMismatch: RevokedRootMismatchError,
  MaxValueMismatch: MaxValueMismatchError,
  ExpiryMismatch: ExpiryMismatchError,
  InvalidSigner: InvalidSignerError,
  SessionAlreadyRevoked: SessionAlreadyRevokedError,
  NotAuthorizedToRevoke: NotAuthorizedToRevokeError,
  NotBoundWallet: NotBoundWalletError,
  UnsupportedCredentialVersion: UnsupportedCredentialVersionError,
  WalletFactoryTimelockNotReady: WalletFactoryTimelockNotReadyError,
  WalletFactoryTimelockActive: WalletFactoryTimelockActiveError,
  InvalidNullifier: InvalidNullifierError,
  TargetNotAllowed: TargetNotAllowedError,
  TooManyTargets: TooManyTargetsError,
};

export function mapContractError(err: unknown): Error {
  if (err instanceof Error) {
    for (const [key, cls] of Object.entries(ERROR_MAP)) {
      if (err.message.includes(key)) {
        return new cls();
      }
    }
  }
  if (err && typeof err === 'object' && 'code' in err) {
    return new RpcError('RPC error: ' + ((err as any).message || (err as any).code), err);
  }
  return err instanceof Error ? err : new Error(String(err));
}
