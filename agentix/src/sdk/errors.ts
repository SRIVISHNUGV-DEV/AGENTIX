export class SignerRequiredError extends Error {
  /**
   * Builds the error raised when a write is attempted without a signer.
   * The message tells the caller exactly what to pass (an ethers Signer) and that AgentIX never wants private keys.
   * @param operation - Name of the attempted operation, shown in the message.
   * Maps to: internal — ContractRegistry methods that need a signer.
   */
  constructor(operation: string) {
    super('Signer required for "' + operation + '". Pass an ethers.Signer (wallet, JsonRpcSigner, etc.) to the AgentIX constructor. AgentIX never asks for private keys.');
    this.name = 'SignerRequiredError';
  }
}

export class NotOwnerError extends Error {
  /** Caller is not the wallet owner. Maps to: contract NotOwner. */
  constructor() { super('Caller is not the wallet owner'); this.name = 'NotOwnerError'; }
}
export class NotEntryPointError extends Error {
  /** Caller is not the EntryPoint. Maps to: contract NotEntryPoint. */
  constructor() { super('Caller is not the EntryPoint'); this.name = 'NotEntryPointError'; }
}
export class NotAuthorizedError extends Error {
  /** Caller is not authorized. Maps to: contract NotAuthorized. */
  constructor() { super('Caller is not authorized'); this.name = 'NotAuthorizedError'; }
}
export class AlreadyInitializedError extends Error {
  /** Wallet already initialized. Maps to: contract AlreadyInitialized. */
  constructor() { super('Wallet already initialized'); this.name = 'AlreadyInitializedError'; }
}
export class NotInitializedError extends Error {
  /** Wallet not initialized. Maps to: contract NotInitialized. */
  constructor() { super('Wallet not initialized'); this.name = 'NotInitializedError'; }
}
export class InvalidOwnerError extends Error {
  /** Invalid owner address (zero). Maps to: contract InvalidOwner. */
  constructor() { super('Invalid owner address (zero)'); this.name = 'InvalidOwnerError'; }
}
export class ExecutionFailedError extends Error {
  /** Wallet execution reverted. Maps to: contract ExecutionFailed. */
  constructor() { super('Wallet execution reverted'); this.name = 'ExecutionFailedError'; }
}
export class CallFailedError extends Error {
  /** Batch call reverted. Maps to: contract CallFailed. */
  constructor() { super('Batch call reverted'); this.name = 'CallFailedError'; }
}
export class BatchTooLargeError extends Error {
  /**
   * Raised when a batch exceeds the contract's max size.
   * @param max - The max batch size the contract allows.
   * Maps to: contract BatchTooLarge (AgentWallet.executeBatch).
   */
  constructor(public max: number) { super('Batch exceeds max size ' + max); this.name = 'BatchTooLargeError'; }
}
export class OwnershipTransferPendingError extends Error {
  /** Ownership transfer already pending. Maps to: contract OwnershipTransferPending. */
  constructor() { super('Ownership transfer already pending'); this.name = 'OwnershipTransferPendingError'; }
}
export class InvalidOwnerSignatureError extends Error {
  /** Owner signature is invalid. Maps to: contract InvalidOwnerSignature. */
  constructor() { super('Owner signature is invalid'); this.name = 'InvalidOwnerSignatureError'; }
}
export class BatchNotAllowedForSessionError extends Error {
  /** Batch execution not allowed via sessions. Maps to: contract BatchNotAllowedForSession. */
  constructor() { super('Batch execution not allowed via sessions'); this.name = 'BatchNotAllowedForSessionError'; }
}
export class UnsupportedCallDataError extends Error {
  /** Unsupported calldata format. Maps to: contract UnsupportedCallData. */
  constructor() { super('Unsupported calldata format'); this.name = 'UnsupportedCallDataError'; }
}
export class SessionNotFoundError extends Error {
  /** Session does not exist. Maps to: contract SessionNotFound. */
  constructor() { super('Session does not exist'); this.name = 'SessionNotFoundError'; }
}
export class SessionExpiredError extends Error {
  /** Session has expired. Maps to: contract SessionExpired. */
  constructor() { super('Session has expired'); this.name = 'SessionExpiredError'; }
}
export class SessionRevokedError extends Error {
  /** Session has been revoked. Maps to: contract SessionIsRevoked. */
  constructor() { super('Session has been revoked'); this.name = 'SessionRevokedError'; }
}
export class SessionAlreadyExistsError extends Error {
  /** Session ID already in use. Maps to: contract SessionAlreadyExists. */
  constructor() { super('Session ID already in use'); this.name = 'SessionAlreadyExistsError'; }
}
export class NotWalletOwnerError extends Error {
  /** Signer is not the wallet owner. Maps to: contract NotWalletOwner. */
  constructor() { super('Signer is not the wallet owner'); this.name = 'NotWalletOwnerError'; }
}
export class LimitExceededError extends Error {
  /** Session spend limit exceeded. Maps to: contract LimitExceeded. */
  constructor() { super('Session spend limit exceeded'); this.name = 'LimitExceededError'; }
}
export class DailySpendLimitExceededError extends Error {
  /** Daily spend limit exceeded. Maps to: contract DailySpendLimitExceeded. */
  constructor() { super('Daily spend limit exceeded'); this.name = 'DailySpendLimitExceededError'; }
}
export class DailyTxLimitExceededError extends Error {
  /** Daily transaction limit exceeded. Maps to: contract DailyTxLimitExceeded. */
  constructor() { super('Daily transaction limit exceeded'); this.name = 'DailyTxLimitExceededError'; }
}
export class InvalidExpiryError extends Error {
  /** Session expiry is invalid (must be in the future). Maps to: contract InvalidExpiry. */
  constructor() { super('Session expiry is invalid (must be in the future)'); this.name = 'InvalidExpiryError'; }
}
export class TooManySessionsError extends Error {
  /**
   * Raised when a wallet already holds the max number of sessions.
   * @param max - The max sessions per wallet the contract allows.
   * Maps to: contract TooManySessions (SessionManager).
   */
  constructor(public max: number) { super('Max ' + max + ' sessions per wallet reached'); this.name = 'TooManySessionsError'; }
}
export class InvalidProofError extends Error {
  /** ZK proof verification failed. Maps to: contract InvalidProof. */
  constructor() { super('ZK proof verification failed'); this.name = 'InvalidProofError'; }
}
export class NotAgentWalletError extends Error {
  /** Address is not an AgentWallet. Maps to: contract NotAgentWallet. */
  constructor() { super('Address is not an AgentWallet'); this.name = 'NotAgentWalletError'; }
}
export class InvalidImplementationError extends Error {
  /** Invalid wallet implementation address. Maps to: contract InvalidImplementation. */
  constructor() { super('Invalid wallet implementation address'); this.name = 'InvalidImplementationError'; }
}
export class WalletAlreadyExistsWithDifferentOwnerError extends Error {
  /** Wallet at this address belongs to a different owner. Maps to: contract WalletAlreadyExistsWithDifferentOwner. */
  constructor() { super('Wallet at this address belongs to a different owner'); this.name = 'WalletAlreadyExistsWithDifferentOwnerError'; }
}
export class IdentityNotFoundError extends Error {
  /** Identity does not exist. Maps to: contract IdentityNotFound. */
  constructor() { super('Identity does not exist'); this.name = 'IdentityNotFoundError'; }
}
export class IdentityInactiveError extends Error {
  /** Identity is inactive. Maps to: contract IdentityInactive. */
  constructor() { super('Identity is inactive'); this.name = 'IdentityInactiveError'; }
}
export class IdentityAlreadyRegisteredError extends Error {
  /** Wallet already has an identity. Maps to: contract IdentityAlreadyRegistered. */
  constructor() { super('Wallet already has an identity'); this.name = 'IdentityAlreadyRegisteredError'; }
}
export class NotIdentityOwnerError extends Error {
  /** Not the identity owner. Maps to: contract NotIdentityOwner. */
  constructor() { super('Not the identity owner'); this.name = 'NotIdentityOwnerError'; }
}
export class InvalidMetadataRootError extends Error {
  /** Metadata root cannot be zero. Maps to: contract InvalidMetadataRoot. */
  constructor() { super('Metadata root cannot be zero'); this.name = 'InvalidMetadataRootError'; }
}
export class MetadataRootUnchangedError extends Error {
  /** New metadata root matches existing. Maps to: contract MetadataRootUnchanged. */
  constructor() { super('New metadata root matches existing'); this.name = 'MetadataRootUnchangedError'; }
}
export class OnlyIssuerError extends Error {
  /** Caller is not an authorized issuer. Maps to: contract OnlyIssuer. */
  constructor() { super('Caller is not an authorized issuer'); this.name = 'OnlyIssuerError'; }
}
export class NullifierUsedError extends Error {
  /** Nullifier has already been used. Maps to: contract NullifierAlreadyUsed. */
  constructor() { super('Nullifier has already been used'); this.name = 'NullifierUsedError'; }
}
export class RootCannotBeZeroError extends Error {
  /** Root cannot be zero. Maps to: contract RootCannotBeZero. */
  constructor() { super('Root cannot be zero'); this.name = 'RootCannotBeZeroError'; }
}
export class OrganizationNotFoundError extends Error {
  /** Organization does not exist. Maps to: contract OrganizationNotFound. */
  constructor() { super('Organization does not exist'); this.name = 'OrganizationNotFoundError'; }
}
export class OrganizationAlreadyExistsError extends Error {
  /** Organization ID already in use. Maps to: contract OrganizationAlreadyExists. */
  constructor() { super('Organization ID already in use'); this.name = 'OrganizationAlreadyExistsError'; }
}
export class OrganizationInactiveError extends Error {
  /** Organization is inactive. Maps to: contract OrganizationInactive. */
  constructor() { super('Organization is inactive'); this.name = 'OrganizationInactiveError'; }
}
export class CapabilityNotFoundError extends Error {
  /** Capability does not exist. Maps to: contract CapabilityNotFound. */
  constructor() { super('Capability does not exist'); this.name = 'CapabilityNotFoundError'; }
}
export class CapabilityAlreadyExistsError extends Error {
  /** Capability ID already in use. Maps to: contract CapabilityExists. */
  constructor() { super('Capability ID already in use'); this.name = 'CapabilityAlreadyExistsError'; }
}
export class NotAuthorizedForCapabilityError extends Error {
  /** Not authorized to manage this capability. Maps to: contract NotAuthorizedForCapability. */
  constructor() { super('Not authorized to manage this capability'); this.name = 'NotAuthorizedForCapabilityError'; }
}
export class GrantNotRevocableError extends Error {
  /** Grant cannot be revoked by caller. Maps to: contract GrantNotRevocable. */
  constructor() { super('Grant cannot be revoked by caller'); this.name = 'GrantNotRevocableError'; }
}
export class DelegatorRevokedError extends Error {
  /** Delegator has been revoked. Maps to: contract DelegatorHasBeenRevoked. */
  constructor() { super('Delegator has been revoked'); this.name = 'DelegatorRevokedError'; }
}
export class AlreadyRevokedDelegationError extends Error {
  /** Delegation leaf already revoked. Maps to: contract AlreadyRevokedDelegation. */
  constructor() { super('Delegation leaf already revoked'); this.name = 'AlreadyRevokedDelegationError'; }
}
export class TimelockNotReadyError extends Error {
  /** Timelock period has not elapsed. Maps to: contract TimelockNotReady. */
  constructor() { super('Timelock period has not elapsed'); this.name = 'TimelockNotReadyError'; }
}
export class TimelockActiveError extends Error {
  /** A pending change already exists. Maps to: contract TimelockActive. */
  constructor() { super('A pending change already exists'); this.name = 'TimelockActiveError'; }
}
// ----- Identity errors -----
export class IdentityAlreadyActiveError extends Error {
  /** Identity is already active. Maps to: contract IdentityAlreadyActive. */
  constructor() { super('Identity is already active'); this.name = 'IdentityAlreadyActiveError'; }
}
export class InvalidIdentityIdError extends Error {
  /** Invalid identity ID. Maps to: contract InvalidIdentityId. */
  constructor() { super('Invalid identity ID'); this.name = 'InvalidIdentityIdError'; }
}
export class NotFactoryError extends Error {
  /** Caller is not the factory. Maps to: contract NotFactory. */
  constructor() { super('Caller is not the factory'); this.name = 'NotFactoryError'; }
}
export class ZeroAddressNotAllowedError extends Error {
  /** Zero address not allowed. Maps to: contract ZeroAddressNotAllowed. */
  constructor() { super('Zero address not allowed'); this.name = 'ZeroAddressNotAllowedError'; }
}

// ----- Wallet errors -----
export class InvalidSessionManagerError extends Error {
  /** Invalid session manager address. Maps to: contract InvalidSessionManager. */
  constructor() { super('Invalid session manager address'); this.name = 'InvalidSessionManagerError'; }
}
export class InvalidEntryPointError extends Error {
  /** Invalid entry point address. Maps to: contract InvalidEntryPoint. */
  constructor() { super('Invalid entry point address'); this.name = 'InvalidEntryPointError'; }
}
export class LengthMismatchError extends Error {
  /** Array length mismatch. Maps to: contract LengthMismatch. */
  constructor() { super('Array length mismatch'); this.name = 'LengthMismatchError'; }
}
export class InvalidRecipientError extends Error {
  /** Invalid recipient address. Maps to: contract InvalidRecipient. */
  constructor() { super('Invalid recipient address'); this.name = 'InvalidRecipientError'; }
}
export class FundingFailedError extends Error {
  /** Wallet funding failed. Maps to: contract FundingFailed. */
  constructor() { super('Wallet funding failed'); this.name = 'FundingFailedError'; }
}
export class InvalidCallDataError extends Error {
  /** Invalid calldata. Maps to: contract InvalidCallData. */
  constructor() { super('Invalid calldata'); this.name = 'InvalidCallDataError'; }
}
export class LightweightSessionValidationFailedError extends Error {
  /** Lightweight session validation failed. Maps to: contract LightweightSessionValidationFailed. */
  constructor() { super('Lightweight session validation failed'); this.name = 'LightweightSessionValidationFailedError'; }
}
export class SessionValidationFailedError extends Error {
  /** ZK session validation failed. Maps to: contract SessionValidationFailed. */
  constructor() { super('ZK session validation failed'); this.name = 'SessionValidationFailedError'; }
}

// ----- Factory errors -----
export class FactoryInvalidSessionManagerError extends Error {
  /** Factory: invalid session manager address. Maps to: contract FactoryInvalidSessionManager. */
  constructor() { super('Factory: invalid session manager address'); this.name = 'FactoryInvalidSessionManagerError'; }
}
export class FactoryInvalidEntryPointError extends Error {
  /** Factory: invalid entry point address. Maps to: contract FactoryInvalidEntryPoint. */
  constructor() { super('Factory: invalid entry point address'); this.name = 'FactoryInvalidEntryPointError'; }
}
export class FactoryInvalidOwnerError extends Error {
  /** Factory: invalid owner address. Maps to: contract FactoryInvalidOwner. */
  constructor() { super('Factory: invalid owner address'); this.name = 'FactoryInvalidOwnerError'; }
}
export class FactoryTimelockNotReadyError extends Error {
  /** Factory: timelock period has not elapsed. Maps to: contract FactoryTimelockNotReady. */
  constructor() { super('Factory: timelock period has not elapsed'); this.name = 'FactoryTimelockNotReadyError'; }
}
export class FactoryTimelockActiveError extends Error {
  /** Factory: a pending change already exists. Maps to: contract FactoryTimelockActive. */
  constructor() { super('Factory: a pending change already exists'); this.name = 'FactoryTimelockActiveError'; }
}
export class InvalidAgentIdentityError extends Error {
  /** Invalid agent identity address. Maps to: contract InvalidAgentIdentity. */
  constructor() { super('Invalid agent identity address'); this.name = 'InvalidAgentIdentityError'; }
}

// ----- Credential Registry errors -----
export class OnlySessionManagerError extends Error {
  /** Caller is not an authorized session manager. Maps to: contract OnlySessionManager. */
  constructor() { super('Caller is not an authorized session manager'); this.name = 'OnlySessionManagerError'; }
}

// ----- Capability Registry errors -----
export class ActionRequiredError extends Error {
  /** Action string is required. Maps to: contract ActionRequired. */
  constructor() { super('Action string is required'); this.name = 'ActionRequiredError'; }
}
export class AlreadyRevokedCapabilityError extends Error {
  /** Capability already revoked. Maps to: contract AlreadyRevokedCapability. */
  constructor() { super('Capability already revoked'); this.name = 'AlreadyRevokedCapabilityError'; }
}
export class AlreadyRevokedGrantError extends Error {
  /** Grant already revoked. Maps to: contract AlreadyRevokedGrant. */
  constructor() { super('Grant already revoked'); this.name = 'AlreadyRevokedGrantError'; }
}
export class InvalidGrantRootError extends Error {
  /** Invalid grant root. Maps to: contract InvalidRoot. */
  constructor() { super('Invalid grant root'); this.name = 'InvalidGrantRootError'; }
}

// ----- Delegation errors -----
export class EmptyChainError extends Error {
  /** Delegation chain is empty. Maps to: contract EmptyChain. */
  constructor() { super('Delegation chain is empty'); this.name = 'EmptyChainError'; }
}
export class ChainTooLongError extends Error {
  /** Delegation chain exceeds max depth. Maps to: contract ChainTooLong. */
  constructor() { super('Delegation chain exceeds max depth'); this.name = 'ChainTooLongError'; }
}
export class ArrayLengthMismatchError extends Error {
  /** Array length mismatch. Maps to: contract ArrayLengthMismatch. */
  constructor() { super('Array length mismatch'); this.name = 'ArrayLengthMismatchError'; }
}
export class ScopeAlreadyRegisteredError extends Error {
  /** Scope action already registered. Maps to: contract ScopeAlreadyRegistered. */
  constructor() { super('Scope action already registered'); this.name = 'ScopeAlreadyRegisteredError'; }
}
export class ScopeLimitExceededError extends Error {
  /** Scope limit exceeded. Maps to: contract ScopeLimitExceeded. */
  constructor() { super('Scope limit exceeded'); this.name = 'ScopeLimitExceededError'; }
}

// ----- Organization errors -----
export class InvalidOwnerAddressError extends Error {
  /** Invalid owner address. Maps to: contract InvalidOwnerAddress. */
  constructor() { super('Invalid owner address'); this.name = 'InvalidOwnerAddressError'; }
}
export class InvalidNameError extends Error {
  /** Invalid organization name. Maps to: contract InvalidName. */
  constructor() { super('Invalid organization name'); this.name = 'InvalidNameError'; }
}
export class InvalidAnchorError extends Error {
  /** Invalid credential anchor address. Maps to: contract InvalidAnchor. */
  constructor() { super('Invalid credential anchor address'); this.name = 'InvalidAnchorError'; }
}
export class OrganizationAlreadyInactiveError extends Error {
  /** Organization is already inactive. Maps to: contract OrganizationAlreadyInactive. */
  constructor() { super('Organization is already inactive'); this.name = 'OrganizationAlreadyInactiveError'; }
}
export class OrganizationAlreadyActiveError extends Error {
  /** Organization is already active. Maps to: contract OrganizationAlreadyActive. */
  constructor() { super('Organization is already active'); this.name = 'OrganizationAlreadyActiveError'; }
}
export class AnchorTimelockNotReadyError extends Error {
  /** Anchor timelock period has not elapsed. Maps to: contract AnchorTimelockNotReady. */
  constructor() { super('Anchor timelock period has not elapsed'); this.name = 'AnchorTimelockNotReadyError'; }
}
export class AnchorTimelockActiveError extends Error {
  /** An anchor change is already pending. Maps to: contract AnchorTimelockActive. */
  constructor() { super('An anchor change is already pending'); this.name = 'AnchorTimelockActiveError'; }
}

// ----- Credential Anchor errors -----
export class InvalidOrganizationIdError extends Error {
  /** Invalid organization ID. Maps to: contract InvalidOrganizationId. */
  constructor() { super('Invalid organization ID'); this.name = 'InvalidOrganizationIdError'; }
}
export class RootAlreadyCurrentError extends Error {
  /** Root is already the current root. Maps to: contract RootAlreadyCurrent. */
  constructor() { super('Root is already the current root'); this.name = 'RootAlreadyCurrentError'; }
}
export class UnauthorizedUpdateError extends Error {
  /** Caller is not authorized to update. Maps to: contract UnauthorizedUpdate. */
  constructor() { super('Caller is not authorized to update'); this.name = 'UnauthorizedUpdateError'; }
}
export class RevokedRootCannotBeZeroError extends Error {
  /** Revoked root cannot be zero. Maps to: contract RevokedRootCannotBeZero. */
  constructor() { super('Revoked root cannot be zero'); this.name = 'RevokedRootCannotBeZeroError'; }
}

// ----- Session errors -----
export class InvalidSessionKeyError extends Error {
  /** Invalid session key address. Maps to: contract InvalidSessionKey. */
  constructor() { super('Invalid session key address'); this.name = 'InvalidSessionKeyError'; }
}
export class NullifierMismatchError extends Error {
  /** Nullifier mismatch in session proof. Maps to: contract NullifierMismatch. */
  constructor() { super('Nullifier mismatch in session proof'); this.name = 'NullifierMismatchError'; }
}
export class RootMismatchError extends Error {
  /** Credential root mismatch. Maps to: contract RootMismatch. */
  constructor() { super('Credential root mismatch'); this.name = 'RootMismatchError'; }
}
export class RevokedRootMismatchError extends Error {
  /** Revoked credential root mismatch. Maps to: contract RevokedRootMismatch. */
  constructor() { super('Revoked credential root mismatch'); this.name = 'RevokedRootMismatchError'; }
}
export class MaxValueMismatchError extends Error {
  /** Max value mismatch. Maps to: contract MaxValueMismatch. */
  constructor() { super('Max value mismatch'); this.name = 'MaxValueMismatchError'; }
}
export class ExpiryMismatchError extends Error {
  /** Expiry mismatch. Maps to: contract ExpiryMismatch. */
  constructor() { super('Expiry mismatch'); this.name = 'ExpiryMismatchError'; }
}
export class InvalidSignerError extends Error {
  /** Invalid signer for session. Maps to: contract InvalidSigner. */
  constructor() { super('Invalid signer for session'); this.name = 'InvalidSignerError'; }
}
export class SessionAlreadyRevokedError extends Error {
  /** Session is already revoked. Maps to: contract SessionAlreadyRevoked. */
  constructor() { super('Session is already revoked'); this.name = 'SessionAlreadyRevokedError'; }
}
export class NotAuthorizedToRevokeError extends Error {
  /** Not authorized to revoke this session. Maps to: contract NotAuthorizedToRevoke. */
  constructor() { super('Not authorized to revoke this session'); this.name = 'NotAuthorizedToRevokeError'; }
}
export class NotBoundWalletError extends Error {
  /** Session is not bound to this wallet. Maps to: contract NotBoundWallet. */
  constructor() { super('Session is not bound to this wallet'); this.name = 'NotBoundWalletError'; }
}
export class UnsupportedCredentialVersionError extends Error {
  /** Unsupported credential version. Maps to: contract UnsupportedCredentialVersion. */
  constructor() { super('Unsupported credential version'); this.name = 'UnsupportedCredentialVersionError'; }
}
export class WalletFactoryTimelockNotReadyError extends Error {
  /** Wallet factory timelock not ready. Maps to: contract WalletFactoryTimelockNotReady. */
  constructor() { super('Wallet factory timelock not ready'); this.name = 'WalletFactoryTimelockNotReadyError'; }
}
export class WalletFactoryTimelockActiveError extends Error {
  /** Wallet factory change already pending. Maps to: contract WalletFactoryTimelockActive. */
  constructor() { super('Wallet factory change already pending'); this.name = 'WalletFactoryTimelockActiveError'; }
}
export class InvalidNullifierError extends Error {
  /** Invalid nullifier. Maps to: contract InvalidNullifier. */
  constructor() { super('Invalid nullifier'); this.name = 'InvalidNullifierError'; }
}
export class TargetNotAllowedError extends Error {
  /** Target not allowed in lightweight session. Maps to: contract TargetNotAllowed. */
  constructor() { super('Target not allowed in lightweight session'); this.name = 'TargetNotAllowedError'; }
}
export class TooManyTargetsError extends Error {
  /** Too many targets for lightweight session. Maps to: contract TooManyTargets. */
  constructor() { super('Too many targets for lightweight session'); this.name = 'TooManyTargetsError'; }
}

export class ConfigurationError extends Error {
  /**
   * Raised for missing or invalid SDK configuration (addresses, RPC URL).
   * @param msg - Human-readable description of what is missing or wrong.
   * Maps to: internal — loadConfig.
   */
  constructor(msg: string) { super(msg); this.name = 'ConfigurationError'; }
}
export class RpcError extends Error {
  /**
   * Raised for RPC-layer failures (connection, unknown method, provider errors).
   * @param msg - Human-readable description; @param cause - The original provider error, when available.
   * Maps to: internal — ContractRegistry and the blockchain adapter's fallback paths.
   */
  constructor(msg: string, public cause?: unknown) { super(msg); this.name = 'RpcError'; }
}
export class ValidationError extends Error {
  /**
   * Raised for invalid SDK-side inputs (bad addresses, zero hashes, past expiries).
   * Thrown before any chain call, so the caller can fix the input without spending gas.
   * @param msg - Human-readable description of the invalid input.
   * Maps to: internal — sdk/utils assert* helpers.
   */
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

/**
 * Translates a raw contract/RPC failure into the typed SDK error for its revert name.
 * Matching is by substring on the error message against ERROR_MAP, so a message naming two reverts maps to whichever key is checked first — treat the result as a best-effort classification, not proof of the exact revert.
 * @returns The mapped SDK error; the original error when nothing matches; a plain Error for non-Error throws; an RpcError for objects carrying a `code` field.
 * Maps to: internal — TransactionManager.send, estimate, and simulate (every SDK write path).
 */
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
