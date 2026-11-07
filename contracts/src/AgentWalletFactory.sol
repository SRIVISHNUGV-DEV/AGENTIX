// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

error InvalidImplementationError();
error FactoryInvalidSessionManagerError();
error FactoryInvalidEntryPointError();
error FactoryInvalidOwnerError();
error WalletAlreadyExistsWithDifferentOwner();
error FactoryTimelockNotReadyError();
error FactoryTimelockActiveError();
error InvalidAgentIdentityError();

/// @notice Minimal interface for AgentWallet initialization.
interface IAgentWallet {
    /// @notice One-time initializer binding owner, SessionManager, and EntryPoint to a fresh clone.
    /// @dev Called once by the factory right after cloning; a second call reverts with `AlreadyInitializedError`.
    /// @param owner Non-zero wallet owner. @param sessionManager Non-zero SessionManager. @param entryPoint Non-zero ERC-4337 EntryPoint.
    /// Maps to: contract AgentWallet.initialize; contract AgentWalletFactory._createWallet
    function initialize(address owner, address sessionManager, address entryPoint) external;
    /// @notice Returns the wallet's owner address.
    /// @dev Read-only.
    /// @return The owner address.
    /// Maps to: contract AgentWallet.owner
    function owner() external view returns (address);
}

/// @notice Minimal interface for AgentIdentity registration.
interface IAgentIdentity {
    /// @notice Registers a new identity for a wallet and returns its fresh sequential id.
    /// @dev Factory-only; reverts for a zero wallet or an already-registered wallet.
    /// @param wallet Non-zero wallet to register.
    /// @return The newly assigned identity id.
    /// Maps to: contract AgentIdentity.registerIdentity
    function registerIdentity(address wallet) external returns (uint256);
}

/// @title AgentWalletFactory
/// @notice Deterministic factory for creating AgentWallet clones. Each wallet is a minimal proxy
///         (EIP-1167 clone) of a shared implementation, initialised with the wallet owner, the
///         canonical SessionManager, and the ERC-4337 EntryPoint.
/// @dev Upgradeable (UUPS). Wallets are created with CREATE2 for deterministic addresses.
contract AgentWalletFactory is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    using Clones for address;

    event WalletCreated(address indexed wallet, address indexed owner, bytes32 indexed salt, address entryPoint);
    event ImplementationProposed(address indexed previous, address indexed next, uint256 activationTime);
    event ImplementationUpdated(address indexed oldImpl, address indexed newImpl);
    event SessionManagerProposed(address indexed previous, address indexed next, uint256 activationTime);
    event SessionManagerUpdated(address indexed oldSM, address indexed newSM);
    event EntryPointProposed(address indexed previous, address indexed next, uint256 activationTime);
    event EntryPointUpdated(address indexed oldEP, address indexed newEP);

    uint256 public constant TIMELOCK_DELAY = 2 days;

    /// @notice The AgentWallet implementation contract that clones are based on.
    address public implementation;
    /// @notice The ERC-4337 EntryPoint contract assigned to all new wallets.
    address public entryPoint;
    /// @notice The SessionManager contract assigned to all new wallets.
    address public sessionManager;
    /// @notice The AgentIdentity registry contract.
    address public agentIdentity;
    /// @notice Counter used to generate unique salts for auto-generated wallets.
    uint256 public walletCount;
    /// @notice Registry of all wallets created by this factory.
    mapping(address => bool) public agentWallets;

    /// @notice Pending implementation address awaiting timelock.
    address public pendingImplementation;
    /// @notice Timestamp when pendingImplementation can be activated.
    uint256 public implementationActivationTime;

    /// @notice Pending SessionManager address awaiting timelock.
    address public pendingSessionManager;
    /// @notice Timestamp when pendingSessionManager can be activated.
    uint256 public sessionManagerActivationTime;

    /// @notice Pending EntryPoint address awaiting timelock.
    address public pendingEntryPoint;
    /// @notice Timestamp when pendingEntryPoint can be activated.
    uint256 public entryPointActivationTime;

    /// @notice Locks the implementation contract so it cannot be initialized directly.
    /// @dev UUPS implementations must never be usable standalone: a directly-initialized implementation would let anyone become its owner. The proxy's `initialize` is the only setup path.
    /// @dev Never reverts.
    /// Maps to: internal — OZ Initializable / UUPSUpgradeable deployment
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice One-time initializer: binds the wallet implementation, SessionManager, and EntryPoint shared by every clone.
    /// @dev Runs once (initializer) from the proxy deployment. All three addresses are validated non-zero here; `agentIdentity` is intentionally left unset and wired later via `setAgentIdentity` (identity registration is skipped until then).
    /// @param implementation_ Non-zero AgentWallet implementation to clone. @param sessionManager_ Non-zero SessionManager assigned to new wallets. @param entryPoint_ Non-zero ERC-4337 EntryPoint assigned to new wallets.
    /// @dev Reverts if called twice (`InvalidInitialization`) or with a zero address (`InvalidImplementationError`, `FactoryInvalidSessionManagerError`, `FactoryInvalidEntryPointError`).
    /// Maps to: deployment script — proxy `initialize` call
    /// @dev Side effects: sets owner to `msg.sender`, sets `implementation`/`sessionManager`/`entryPoint`. Security: deployer becomes owner.
    function initialize(
        address implementation_,
        address sessionManager_,
        address entryPoint_
    ) public initializer {
        __Ownable_init(msg.sender);
        if (implementation_ == address(0)) revert InvalidImplementationError();
        if (sessionManager_ == address(0)) revert FactoryInvalidSessionManagerError();
        if (entryPoint_ == address(0)) revert FactoryInvalidEntryPointError();
        implementation = implementation_;
        sessionManager = sessionManager_;
        entryPoint = entryPoint_;
    }

    /// @notice Creates a wallet for an owner with an auto-generated salt, returning the existing wallet if one already exists for that salt.
    /// @dev Salt derives from `(owner, chainid, walletCount)`, so each call mints a fresh address; `walletCount` only increments on actual creation. Anyone may call it — the owner is a parameter, not `msg.sender`, so wallets can be pre-created for users.
    /// @param owner Non-zero future wallet owner.
    /// @return wallet Address of the newly created wallet, or the existing wallet at that salt if it already exists for the same owner.
    /// @dev Reverts with `FactoryInvalidOwnerError` (zero owner) or `WalletAlreadyExistsWithDifferentOwner` (salt collision with a different owner).
    /// Maps to: TS SDK wallet.ts createWallet; contract AgentIdentity.registerIdentity; event WalletCreated
    /// @dev Side effects: deploys a CREATE2 clone and initializes it (via `_createWallet`), emits `WalletCreated` on creation only.
    function createWallet(address owner) external returns (address wallet) {
        bytes32 salt = keccak256(abi.encode(owner, block.chainid, walletCount));
        return _createWallet(owner, salt);
    }

    /// @notice Creates a wallet for an owner with a caller-chosen salt, for deterministic addresses (e.g. counterfactual wallets).
    /// @dev Same creation logic as the auto-salt overload; reusing a salt is idempotent for the same owner (returns the existing wallet, no new deployment, no event) and reverts for a different owner. Choose salts carefully — a salt already used by someone else's wallet cannot be reused.
    /// @param owner Non-zero future wallet owner. @param salt CREATE2 salt; the wallet address is fully determined by it.
    /// @return wallet Address of the newly created wallet, or the existing wallet at that salt.
    /// @dev Reverts with `FactoryInvalidOwnerError` or `WalletAlreadyExistsWithDifferentOwner`.
    /// Maps to: TS SDK wallet.ts createWallet (salt overload); contract AgentIdentity.registerIdentity; event WalletCreated
    /// @dev Side effects: deploys a CREATE2 clone and initializes it (via `_createWallet`), emits `WalletCreated` on creation only.
    function createWallet(address owner, bytes32 salt) external returns (address wallet) {
        return _createWallet(owner, salt);
    }

    /// @notice Predicts the deterministic wallet address for a salt without deploying anything.
    /// @dev Read-only; useful for counterfactual addresses (fund a wallet before it exists). The prediction is only valid while `implementation` is unchanged — an implementation upgrade changes the predicted address.
    /// @param salt CREATE2 salt to predict for.
    /// @return wallet The address a clone would be deployed at for this salt.
    /// Maps to: TS SDK wallet.ts getAddress / predictAddress
    function getAddress(bytes32 salt) external view returns (address wallet) {
        return implementation.predictDeterministicAddress(salt, address(this));
    }

    /// @notice Proposes a new AgentWallet implementation, effective only after the 2-day timelock and `acceptImplementation`.
    /// @dev Only affects wallets created after activation — already-deployed clones keep pointing at the old implementation (EIP-1167 clones are immutable). A bad implementation only harms future wallets, which is why the delay still matters.
    /// @param newImplementation Non-zero proposed implementation.
    /// @dev Emits `ImplementationProposed` with the activation timestamp.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` (non-owner), `InvalidImplementationError` (zero address), `FactoryTimelockActiveError` (a proposal is already pending).
    /// Maps to: contract AgentWallet (implementation being swapped); event ImplementationProposed
    /// @dev Side effects: sets `pendingImplementation` and `implementationActivationTime`, emits `ImplementationProposed`. Security: owner-only.
    function proposeImplementation(address newImplementation) external onlyOwner {
        if (newImplementation == address(0)) revert InvalidImplementationError();
        if (pendingImplementation != address(0)) revert FactoryTimelockActiveError();
        pendingImplementation = newImplementation;
        implementationActivationTime = block.timestamp + TIMELOCK_DELAY;
        emit ImplementationProposed(implementation, newImplementation, implementationActivationTime);
    }

    /// @notice Activates the pending wallet implementation once the 2-day timelock has elapsed.
    /// @dev Calling early reverts. Only future clones use the new implementation; existing wallets are unaffected.
    /// @dev Emits `ImplementationUpdated` on success.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` (non-owner), `InvalidImplementationError` (no proposal pending), `FactoryTimelockNotReadyError` (delay not yet elapsed).
    /// Maps to: contract AgentWallet (implementation being swapped); event ImplementationUpdated
    /// @dev Side effects: sets `implementation`, clears the pending proposal and activation time, emits `ImplementationUpdated`. Security: owner-only.
    function acceptImplementation() external onlyOwner {
        if (pendingImplementation == address(0)) revert InvalidImplementationError();
        if (block.timestamp < implementationActivationTime) revert FactoryTimelockNotReadyError();
        address oldImpl = implementation;
        implementation = pendingImplementation;
        pendingImplementation = address(0);
        implementationActivationTime = 0;
        emit ImplementationUpdated(oldImpl, implementation);
    }

    /// @notice Proposes a new SessionManager for future wallets, effective only after the 2-day timelock and `acceptSessionManager`.
    /// @dev Only affects wallets created after activation — existing wallets keep their own SessionManager (each wallet stores its own address). The SessionManager is the authorization policy for new wallets, hence the delay.
    /// @param newSessionManager Non-zero proposed SessionManager.
    /// @dev Emits `SessionManagerProposed` with the activation timestamp.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` (non-owner), `FactoryInvalidSessionManagerError` (zero address), `FactoryTimelockActiveError` (a proposal is already pending).
    /// Maps to: contract SessionManager (the dependency being swapped); event SessionManagerProposed
    /// @dev Side effects: sets `pendingSessionManager` and `sessionManagerActivationTime`, emits `SessionManagerProposed`. Security: owner-only.
    function proposeSessionManager(address newSessionManager) external onlyOwner {
        if (newSessionManager == address(0)) revert FactoryInvalidSessionManagerError();
        if (pendingSessionManager != address(0)) revert FactoryTimelockActiveError();
        pendingSessionManager = newSessionManager;
        sessionManagerActivationTime = block.timestamp + TIMELOCK_DELAY;
        emit SessionManagerProposed(sessionManager, newSessionManager, sessionManagerActivationTime);
    }

    /// @notice Activates the pending SessionManager once the 2-day timelock has elapsed.
    /// @dev Calling early reverts. Only future wallets get the new manager; existing wallets are unaffected.
    /// @dev Emits `SessionManagerUpdated` on success.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` (non-owner), `FactoryInvalidSessionManagerError` (no proposal pending), `FactoryTimelockNotReadyError` (delay not yet elapsed).
    /// Maps to: contract SessionManager (the dependency being swapped); event SessionManagerUpdated
    /// @dev Side effects: sets `sessionManager`, clears the pending proposal and activation time, emits `SessionManagerUpdated`. Security: owner-only.
    function acceptSessionManager() external onlyOwner {
        if (pendingSessionManager == address(0)) revert FactoryInvalidSessionManagerError();
        if (block.timestamp < sessionManagerActivationTime) revert FactoryTimelockNotReadyError();
        address oldSM = sessionManager;
        sessionManager = pendingSessionManager;
        pendingSessionManager = address(0);
        sessionManagerActivationTime = 0;
        emit SessionManagerUpdated(oldSM, sessionManager);
    }

    /// @notice Proposes a new EntryPoint for future wallets, effective only after the 2-day timelock and `acceptEntryPoint`.
    /// @dev Only affects wallets created after activation — existing wallets keep their own EntryPoint. The EntryPoint authenticates every user-op for new wallets, hence the delay.
    /// @param newEntryPoint Non-zero proposed EntryPoint.
    /// @dev Emits `EntryPointProposed` with the activation timestamp.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` (non-owner), `FactoryInvalidEntryPointError` (zero address), `FactoryTimelockActiveError` (a proposal is already pending).
    /// Maps to: ERC-4337 EntryPoint; event EntryPointProposed
    /// @dev Side effects: sets `pendingEntryPoint` and `entryPointActivationTime`, emits `EntryPointProposed`. Security: owner-only.
    function proposeEntryPoint(address newEntryPoint) external onlyOwner {
        if (newEntryPoint == address(0)) revert FactoryInvalidEntryPointError();
        if (pendingEntryPoint != address(0)) revert FactoryTimelockActiveError();
        pendingEntryPoint = newEntryPoint;
        entryPointActivationTime = block.timestamp + TIMELOCK_DELAY;
        emit EntryPointProposed(entryPoint, newEntryPoint, entryPointActivationTime);
    }

    /// @notice Activates the pending EntryPoint once the 2-day timelock has elapsed.
    /// @dev Calling early reverts. Only future wallets get the new EntryPoint; existing wallets are unaffected.
    /// @dev Emits `EntryPointUpdated` on success.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` (non-owner), `FactoryInvalidEntryPointError` (no proposal pending), `FactoryTimelockNotReadyError` (delay not yet elapsed).
    /// Maps to: ERC-4337 EntryPoint; event EntryPointUpdated
    /// @dev Side effects: sets `entryPoint`, clears the pending proposal and activation time, emits `EntryPointUpdated`. Security: owner-only.
    function acceptEntryPoint() external onlyOwner {
        if (pendingEntryPoint == address(0)) revert FactoryInvalidEntryPointError();
        if (block.timestamp < entryPointActivationTime) revert FactoryTimelockNotReadyError();
        address oldEP = entryPoint;
        entryPoint = pendingEntryPoint;
        pendingEntryPoint = address(0);
        entryPointActivationTime = 0;
        emit EntryPointUpdated(oldEP, entryPoint);
    }

    /// @notice Reports whether an address is a wallet created by this factory.
    /// @dev Read-only; the SessionManager relies on this registry to decide which callers are wallets (`onlyWallet`). An address deployed elsewhere — even a valid AgentWallet clone — returns false.
    /// @param wallet Address to check.
    /// @return True only if this factory created the wallet; false otherwise (never reverts).
    /// Maps to: contract SessionManager.onlyWallet; TS SDK wallet.ts isAgentWallet
    function isAgentWallet(address wallet) external view returns (bool) {
        return agentWallets[wallet];
    }

    /// @notice Wires (or re-wires) the AgentIdentity registry used to register identities for new wallets.
    /// @dev Owner-only, no timelock: this only affects wallets created after the call, and setting it to a wrong-but-nonzero address would silently register identities in the wrong registry — verify the address before calling. Setting it back to address(0) is not possible here (zero reverts); identity registration is skipped while it is unset.
    /// @param agentIdentity_ Non-zero AgentIdentity contract.
    /// @dev No event is emitted.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` (non-owner) or `InvalidAgentIdentityError` (zero address).
    /// Maps to: contract AgentIdentity.registerIdentity (called for new wallets once set)
    /// @dev Side effects: sets `agentIdentity`. Security: owner-only; no timelock, so double-check the address.
    function setAgentIdentity(address agentIdentity_) external onlyOwner {
        if (agentIdentity_ == address(0)) revert InvalidAgentIdentityError();
        agentIdentity = agentIdentity_;
    }

    /// @notice Internal shared creation logic: deploys the deterministic clone (or returns the existing wallet) and registers its identity.
    /// @dev Creation is idempotent for the same owner: if code already exists at the predicted address and its owner matches, the existing wallet is returned with no deployment, no identity call, and no event. If the address belongs to a different owner, it reverts — a salt can never be stolen. Identity registration is best-effort only in the sense that it is skipped while `agentIdentity` is unset; when set, a reverting registry reverts the whole creation.
    /// @param owner Non-zero wallet owner. @param salt CREATE2 salt determining the wallet address.
    /// @return wallet The created (or pre-existing) wallet address.
    /// @dev Reverts with `FactoryInvalidOwnerError` (zero owner) or `WalletAlreadyExistsWithDifferentOwner` (address taken by another owner).
    /// Maps to: internal — AgentWalletFactory.createWallet (both overloads); contract AgentIdentity.registerIdentity; event WalletCreated
    /// @dev Side effects: on creation, deploys a clone, initializes it, marks it in `agentWallets`, increments `walletCount`, registers the identity, emits `WalletCreated`.
    function _createWallet(address owner, bytes32 salt) internal returns (address wallet) {
        if (owner == address(0)) revert FactoryInvalidOwnerError();
        wallet = implementation.predictDeterministicAddress(salt, address(this));

        if (wallet.code.length == 0) {
            wallet = implementation.cloneDeterministic(salt);
            IAgentWallet(wallet).initialize(owner, sessionManager, entryPoint);
            agentWallets[wallet] = true;
            walletCount++;
            if (agentIdentity != address(0)) {
                IAgentIdentity(agentIdentity).registerIdentity(wallet);
            }
            emit WalletCreated(wallet, owner, salt, entryPoint);
        } else if (IAgentWallet(wallet).owner() != owner) {
            revert WalletAlreadyExistsWithDifferentOwner();
        }
    }

    /// @notice UUPS upgrade gate: only the owner may authorize an implementation upgrade of the factory itself.
    /// @dev Reverts with OZ `OwnableUnauthorizedAccount` for non-owners. Upgrading the factory changes how future wallets are created — verify the new implementation before authorizing.
    /// Maps to: internal — OZ UUPSUpgradeable upgrade flow
    function _authorizeUpgrade(address) internal override onlyOwner {}

    uint256[50] private __gap;
}
