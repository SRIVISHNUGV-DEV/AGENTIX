export { AgentIX } from './AgentIX.js';
export { loadConfig } from './config.js';
export { ContractRegistry } from './contracts.js';
export { Database } from './database.js';
export { TransactionManager, type TxOptions } from './transaction.js';
export { WalletModule } from './wallet.js';
export { IdentityModule } from './identity.js';
export { SessionModule } from './session.js';
export { CredentialModule } from './credential.js';
export { OrganizationModule } from './organization.js';
export { CapabilityModule } from './capability.js';
export { DelegationModule } from './delegation.js';
export { EventIndexer } from './events.js';
export { OwnerModule } from './onlyOwner/index.js';

export type { Signer } from 'ethers';

export * from './types.js';

// Export all errors explicitly (not via * to avoid name conflicts)
export {
  SignerRequiredError,
  NotOwnerError,
  NotEntryPointError,
  NotAuthorizedError,
  AlreadyInitializedError,
  NotInitializedError,
  InvalidOwnerError,
  ExecutionFailedError,
  CallFailedError,
  BatchTooLargeError,
  OwnershipTransferPendingError,
  InvalidOwnerSignatureError,
  BatchNotAllowedForSessionError,
  UnsupportedCallDataError,
  SessionNotFoundError,
  SessionExpiredError,
  SessionRevokedError,
  SessionAlreadyExistsError,
  NotWalletOwnerError,
  LimitExceededError,
  DailySpendLimitExceededError,
  DailyTxLimitExceededError,
  InvalidExpiryError,
  TooManySessionsError,
  InvalidProofError,
  NotAgentWalletError,
  InvalidImplementationError,
  WalletAlreadyExistsWithDifferentOwnerError,
  IdentityNotFoundError,
  IdentityInactiveError,
  IdentityAlreadyRegisteredError,
  NotIdentityOwnerError,
  InvalidMetadataRootError,
  MetadataRootUnchangedError,
  OnlyIssuerError,
  NullifierUsedError,
  RootCannotBeZeroError,
  OrganizationNotFoundError,
  OrganizationAlreadyExistsError,
  OrganizationInactiveError,
  CapabilityNotFoundError,
  CapabilityAlreadyExistsError,
  NotAuthorizedForCapabilityError,
  GrantNotRevocableError,
  DelegatorRevokedError,
  AlreadyRevokedDelegationError,
  // Identity
  IdentityAlreadyActiveError,
  InvalidIdentityIdError,
  NotFactoryError,
  ZeroAddressNotAllowedError,
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
  // Credential
  OnlySessionManagerError,
  ActionRequiredError,
  AlreadyRevokedCapabilityError,
  AlreadyRevokedGrantError,
  InvalidGrantRootError,
  // Delegation
  EmptyChainError,
  ChainTooLongError,
  ArrayLengthMismatchError,
  ScopeAlreadyRegisteredError,
  ScopeLimitExceededError,
  // Organization
  InvalidOwnerAddressError,
  InvalidNameError,
  InvalidAnchorError,
  OrganizationAlreadyInactiveError,
  OrganizationAlreadyActiveError,
  AnchorTimelockNotReadyError,
  AnchorTimelockActiveError,
  // Credential Anchor
  InvalidOrganizationIdError,
  RootAlreadyCurrentError,
  UnauthorizedUpdateError,
  RevokedRootCannotBeZeroError,
  // Session
  InvalidSessionKeyError,
  NullifierMismatchError,
  RootMismatchError,
  RevokedRootMismatchError,
  MaxValueMismatchError,
  ExpiryMismatchError,
  InvalidSignerError,
  SessionAlreadyRevokedError,
  NotAuthorizedToRevokeError,
  NotBoundWalletError,
  UnsupportedCredentialVersionError,
  WalletFactoryTimelockNotReadyError,
  WalletFactoryTimelockActiveError,
  InvalidNullifierError,
  TargetNotAllowedError,
  TooManyTargetsError,
  TimelockNotReadyError,
  TimelockActiveError,
  ConfigurationError,
  RpcError,
  ValidationError,
  mapContractError,
} from './errors.js';

export * from './utils.js';
