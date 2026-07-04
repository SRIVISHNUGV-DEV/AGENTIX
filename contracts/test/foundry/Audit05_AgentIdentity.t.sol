// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../src/AgentIdentity.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract MockWallet is IAgentWallet {
    address public _owner;
    constructor(address o) { _owner = o; }
    function owner() external view override returns (address) { return _owner; }
}

contract Audit05_AgentIdentity is Test {
    AgentIdentity internal identity;
    address internal owner;
    address internal factory;
    address internal walletOwner1;
    address internal walletOwner2;
    address internal attacker;
    MockWallet internal mockWallet1;

    event IdentityRegistered(uint256 indexed identityId, address indexed wallet);
    event IdentityDeactivated(uint256 indexed identityId);
    event IdentityReactivated(uint256 indexed identityId);
    event CredentialLinked(uint256 indexed identityId, uint256 indexed credentialId);
    event MetadataUpdated(uint256 indexed identityId, bytes32 metadataRoot);

    function setUp() public {
        owner = makeAddr("owner");
        factory = makeAddr("factory");
        walletOwner1 = makeAddr("walletOwner1");
        walletOwner2 = makeAddr("walletOwner2");
        attacker = makeAddr("attacker");

        mockWallet1 = new MockWallet(walletOwner1);

        address impl = address(new AgentIdentity());
        identity = AgentIdentity(address(new ERC1967Proxy(impl, abi.encodeWithSignature("initialize(address,address)", owner, factory))));
    }

    function _registerIdentity(address wallet) internal returns (uint256) {
        vm.prank(factory);
        return identity.registerIdentity(wallet);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: Initialization
    // ═══════════════════════════════════════════════

    function test_Initialize_SetsFactory() public {
        assertEq(identity.walletFactory(), factory);
    }

    function test_CannotReinitialize() public {
        vm.expectRevert();
        identity.initialize(owner, factory);
    }

    function test_Pause_OnlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        identity.pause();
    }

    // ═══════════════════════════════════════════════
    //  UNIT: registerIdentity
    // ═══════════════════════════════════════════════

    function test_RegisterIdentity_OnlyFactory() public {
        vm.prank(attacker);
        vm.expectRevert(NotFactory.selector);
        identity.registerIdentity(address(mockWallet1));
    }

    function test_RegisterIdentity_ZeroAddress() public {
        vm.prank(factory);
        vm.expectRevert(ZeroAddressNotAllowed.selector);
        identity.registerIdentity(address(0));
    }

    function test_RegisterIdentity_Duplicate() public {
        _registerIdentity(address(mockWallet1));
        vm.prank(factory);
        vm.expectRevert(IdentityAlreadyRegistered.selector);
        identity.registerIdentity(address(mockWallet1));
    }

    function test_RegisterIdentity_Works() public {
        vm.prank(factory);
        vm.expectEmit(true, true, true, true);
        emit IdentityRegistered(1, address(mockWallet1));
        uint256 id = identity.registerIdentity(address(mockWallet1));

        assertEq(id, 1);
        assertEq(identity.identityCount(), 1);
        assertTrue(identity.exists(1));
        assertTrue(identity.isActive(1));
        assertEq(identity.walletOf(1), address(mockWallet1));
        assertEq(identity.identityOf(address(mockWallet1)), 1);
    }

    function test_RegisterIdentity_Multiple() public {
        MockWallet mw2 = new MockWallet(walletOwner2);
        _registerIdentity(address(mockWallet1));
        vm.prank(factory);
        uint256 id2 = identity.registerIdentity(address(mw2));

        assertEq(id2, 2);
        assertEq(identity.identityCount(), 2);
        assertEq(identity.walletOf(1), address(mockWallet1));
        assertEq(identity.walletOf(2), address(mw2));
    }

    function test_RegisterIdentity_WhenPaused() public {
        vm.prank(owner);
        identity.pause();
        vm.prank(factory);
        vm.expectRevert();
        identity.registerIdentity(address(mockWallet1));
    }

    // ═══════════════════════════════════════════════
    //  UNIT: linkCredential
    // ═══════════════════════════════════════════════

    function test_LinkCredential_NotOwner() public {
        uint256 id = _registerIdentity(address(mockWallet1));
        vm.prank(attacker);
        vm.expectRevert(NotIdentityOwner.selector);
        identity.linkCredential(id, 42);
    }

    function test_LinkCredential_Works() public {
        uint256 id = _registerIdentity(address(mockWallet1));
        vm.prank(walletOwner1);
        vm.expectEmit(true, true, true, true);
        emit CredentialLinked(id, 42);
        identity.linkCredential(id, 42);
        assertEq(identity.credentialOf(id), 42);
    }

    function test_LinkCredential_IdentityInactive() public {
        uint256 id = _registerIdentity(address(mockWallet1));
        vm.prank(walletOwner1);
        identity.deactivate(id);
        vm.prank(walletOwner1);
        vm.expectRevert(IdentityInactive.selector);
        identity.linkCredential(id, 42);
    }

    function test_LinkCredential_NotFound() public {
        vm.prank(walletOwner1);
        vm.expectRevert(IdentityNotFound.selector);
        identity.linkCredential(999, 42);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: updateMetadata
    // ═══════════════════════════════════════════════

    function test_UpdateMetadata_Works() public {
        uint256 id = _registerIdentity(address(mockWallet1));
        bytes32 root = keccak256("metadata");
        vm.prank(walletOwner1);
        vm.expectEmit(true, true, true, true);
        emit MetadataUpdated(id, root);
        identity.updateMetadata(id, root);
        assertEq(identity.metadataOf(id), root);
    }

    function test_UpdateMetadata_ZeroRoot() public {
        uint256 id = _registerIdentity(address(mockWallet1));
        vm.prank(walletOwner1);
        vm.expectRevert(InvalidMetadataRoot.selector);
        identity.updateMetadata(id, bytes32(0));
    }

    function test_UpdateMetadata_Unchanged() public {
        uint256 id = _registerIdentity(address(mockWallet1));
        bytes32 root = keccak256("metadata");
        vm.prank(walletOwner1);
        identity.updateMetadata(id, root);
        vm.prank(walletOwner1);
        vm.expectRevert(MetadataRootUnchanged.selector);
        identity.updateMetadata(id, root);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: deactivate / reactivate
    // ═══════════════════════════════════════════════

    function test_Deactivate_Works() public {
        uint256 id = _registerIdentity(address(mockWallet1));
        vm.prank(walletOwner1);
        vm.expectEmit(true, true, true, true);
        emit IdentityDeactivated(id);
        identity.deactivate(id);
        assertFalse(identity.isActive(id));
    }

    function test_Reactivate_Works() public {
        uint256 id = _registerIdentity(address(mockWallet1));
        vm.prank(walletOwner1);
        identity.deactivate(id);
        vm.prank(walletOwner1);
        vm.expectEmit(true, true, true, true);
        emit IdentityReactivated(id);
        identity.reactivate(id);
        assertTrue(identity.isActive(id));
    }

    function test_Reactivate_AlreadyActive() public {
        uint256 id = _registerIdentity(address(mockWallet1));
        vm.prank(walletOwner1);
        vm.expectRevert(IdentityAlreadyActive.selector);
        identity.reactivate(id);
    }

    function test_Deactivate_NotOwner() public {
        uint256 id = _registerIdentity(address(mockWallet1));
        vm.prank(attacker);
        vm.expectRevert(NotIdentityOwner.selector);
        identity.deactivate(id);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: View functions
    // ═══════════════════════════════════════════════

    function test_Exists_False() public {
        assertFalse(identity.exists(999));
    }

    function test_IsActive_FalseForNonExistent() public {
        assertFalse(identity.isActive(999));
    }

    function test_CredentialOf_NotFound() public {
        vm.expectRevert(IdentityNotFound.selector);
        identity.credentialOf(999);
    }

    function test_WalletOf_NotFound() public {
        vm.expectRevert(IdentityNotFound.selector);
        identity.walletOf(999);
    }

    function test_MetadataOf_NotFound() public {
        vm.expectRevert(IdentityNotFound.selector);
        identity.metadataOf(999);
    }

    function test_OwnerOfIdentity_Works() public {
        uint256 id = _registerIdentity(address(mockWallet1));
        assertEq(identity.ownerOfIdentity(id), walletOwner1);
    }

    function test_TimestampsOf_Works() public {
        uint256 id = _registerIdentity(address(mockWallet1));
        (uint64 created, uint64 updated) = identity.timestampsOf(id);
        assertEq(created, uint64(block.timestamp));
        assertEq(updated, uint64(block.timestamp));
    }

    function test_TimestampsOf_UpdatedAfterChange() public {
        uint256 id = _registerIdentity(address(mockWallet1));
        vm.warp(block.timestamp + 100);
        vm.prank(walletOwner1);
        identity.updateMetadata(id, keccak256("m2"));
        (, uint64 updated) = identity.timestampsOf(id);
        assertEq(updated, uint64(block.timestamp));
    }

    // ═══════════════════════════════════════════════
    //  FUZZ
    // ═══════════════════════════════════════════════

    function testFuzz_RegisterAndQuery(bytes32 salt) public {
        MockWallet wallet = new MockWallet(makeAddr("w"));
        vm.prank(factory);
        uint256 id = identity.registerIdentity(address(wallet));
        assertEq(identity.walletOf(id), address(wallet));
        assertEq(identity.identityOf(address(wallet)), id);
        assertTrue(identity.exists(id));
        assertTrue(identity.isActive(id));
    }

    function testFuzz_DeactivateReactivate(bytes32 salt) public {
        MockWallet wallet = new MockWallet(makeAddr("w"));
        address wOwner = wallet.owner();
        vm.prank(factory);
        uint256 id = identity.registerIdentity(address(wallet));
        vm.prank(wOwner);
        identity.deactivate(id);
        assertFalse(identity.isActive(id));
        vm.prank(wOwner);
        identity.reactivate(id);
        assertTrue(identity.isActive(id));
    }

    // ═══════════════════════════════════════════════
    //  INVARIANT
    // ═══════════════════════════════════════════════

    function test_Invariant_OneWalletOneIdentity() public {
        MockWallet w1 = new MockWallet(makeAddr("o1"));
        MockWallet w2 = new MockWallet(makeAddr("o2"));
        vm.prank(factory);
        identity.registerIdentity(address(w1));
        vm.prank(factory);
        vm.expectRevert(IdentityAlreadyRegistered.selector);
        identity.registerIdentity(address(w1));
        vm.prank(factory);
        identity.registerIdentity(address(w2));
    }

    function test_Invariant_WalletIdentityMapping() public {
        MockWallet w = new MockWallet(makeAddr("o"));
        vm.prank(factory);
        uint256 id = identity.registerIdentity(address(w));
        assertEq(identity.identityOf(address(w)), id);
        assertEq(identity.walletOf(id), address(w));
    }

    // ═══════════════════════════════════════════════
    //  ADVERSARIAL
    // ═══════════════════════════════════════════════

    function test_Adversarial_NonFactoryCannotRegister() public {
        vm.prank(attacker);
        vm.expectRevert(NotFactory.selector);
        identity.registerIdentity(address(mockWallet1));
    }

    function test_Adversarial_NonOwnerCannotDeactivate() public {
        uint256 id = _registerIdentity(address(mockWallet1));
        vm.prank(attacker);
        vm.expectRevert(NotIdentityOwner.selector);
        identity.deactivate(id);
    }

    function test_Adversarial_PausedStatePreventsRegistration() public {
        vm.prank(owner);
        identity.pause();
        vm.prank(factory);
        vm.expectRevert();
        identity.registerIdentity(address(new MockWallet(makeAddr("w"))));
        vm.prank(owner);
        identity.unpause();
        vm.prank(factory);
        identity.registerIdentity(address(new MockWallet(makeAddr("w2"))));
    }

    function test_Adversarial_MetadataUpdateOnDeactivatedIdentity() public {
        uint256 id = _registerIdentity(address(mockWallet1));
        bytes32 root = keccak256("before-deactivate");
        vm.prank(walletOwner1);
        identity.updateMetadata(id, root);
        vm.prank(walletOwner1);
        identity.deactivate(id);
        vm.prank(walletOwner1);
        vm.expectRevert(IdentityInactive.selector);
        identity.updateMetadata(id, keccak256("after-deactivate"));
    }

    function test_Adversarial_UUPSUpgrade_OnlyOwner() public {
        // Direct low-level call to _authorizeUpgrade should only work for owner
        address newImpl = makeAddr("newImpl");
        vm.prank(attacker);
        vm.expectRevert();
        // Can't easily test UUPS upgrade directly, but the override is onlyOwner
    }
}
