// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../src/CredentialRegistry.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract Audit01_CredentialRegistry is Test {
    CredentialRegistry internal registry;
    address internal impl;
    address internal owner;
    address internal issuer1;
    address internal issuer2;
    address internal sessionManager1;
    address internal sessionManager2;
    address internal attacker;
    address internal random;

    event ActiveRootUpdated(bytes32 indexed newRoot);
    event RevokedSecretRootUpdated(bytes32 indexed newRoot);

    function setUp() public {
        owner = makeAddr("owner");
        issuer1 = makeAddr("issuer1");
        issuer2 = makeAddr("issuer2");
        sessionManager1 = makeAddr("sm1");
        sessionManager2 = makeAddr("sm2");
        attacker = makeAddr("attacker");
        random = makeAddr("random");

        impl = address(new CredentialRegistry());
        ERC1967Proxy proxy = new ERC1967Proxy(impl, abi.encodeWithSignature("initialize(address)", owner));
        registry = CredentialRegistry(address(proxy));

        vm.prank(owner);
        registry.addIssuer(issuer1);
        vm.prank(owner);
        registry.setSessionManager(sessionManager1, true);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: Initialization
    // ═══════════════════════════════════════════════

    function test_Initialize_SetsOwnerAsIssuer() public {
        assertTrue(registry.issuers(owner));
    }

    function test_Initialize_SetsOwner() public {
        assertEq(registry.owner(), owner);
    }

    function test_CannotReinitialize() public {
        vm.expectRevert();
        registry.initialize(attacker);
    }

    function test_ImplementationCannotBeInitialized() public {
        vm.expectRevert();
        CredentialRegistry(impl).initialize(attacker);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: Pausable
    // ═══════════════════════════════════════════════

    function test_Pause_OnlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        registry.pause();
    }

    function test_Pause_Works() public {
        vm.prank(owner);
        registry.pause();
        assertTrue(registry.paused());
    }

    function test_Unpause_OnlyOwner() public {
        vm.prank(owner);
        registry.pause();
        vm.prank(attacker);
        vm.expectRevert();
        registry.unpause();
    }

    function test_Unpause_Works() public {
        vm.prank(owner);
        registry.pause();
        vm.prank(owner);
        registry.unpause();
        assertFalse(registry.paused());
    }

    // ═══════════════════════════════════════════════
    //  UNIT: Issuer Management
    // ═══════════════════════════════════════════════

    function test_AddIssuer_OnlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        registry.addIssuer(issuer2);
    }

    function test_AddIssuer_Works() public {
        vm.prank(owner);
        registry.addIssuer(issuer2);
        assertTrue(registry.issuers(issuer2));
    }

    function test_AddIssuer_Idempotent() public {
        assertTrue(registry.issuers(issuer1));
        vm.prank(owner);
        registry.addIssuer(issuer1);
        assertTrue(registry.issuers(issuer1));
    }

    function test_RemoveIssuer_OnlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        registry.removeIssuer(issuer1);
    }

    function test_RemoveIssuer_Works() public {
        vm.prank(owner);
        registry.removeIssuer(issuer1);
        assertFalse(registry.issuers(issuer1));
    }

    function test_RemovedIssuer_CannotUpdateRoot() public {
        vm.prank(owner);
        registry.removeIssuer(issuer1);
        vm.prank(issuer1);
        vm.expectRevert(OnlyIssuer.selector);
        registry.updateActiveRoot(keccak256("test"));
    }

    // ═══════════════════════════════════════════════
    //  UNIT: SessionManager Management
    // ═══════════════════════════════════════════════

    function test_SetSessionManager_OnlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        registry.setSessionManager(sessionManager2, true);
    }

    function test_SetSessionManager_Works() public {
        vm.prank(owner);
        registry.setSessionManager(sessionManager2, true);
        assertTrue(registry.sessionManagers(sessionManager2));
    }

    function test_RemoveSessionManager_Works() public {
        vm.prank(owner);
        registry.setSessionManager(sessionManager1, false);
        assertFalse(registry.sessionManagers(sessionManager1));
    }

    function test_RemovedSessionManager_CannotMarkNullifier() public {
        vm.prank(owner);
        registry.setSessionManager(sessionManager1, false);
        vm.prank(sessionManager1);
        vm.expectRevert(OnlySessionManager.selector);
        registry.markNullifierUsed(keccak256("nullifier"));
    }

    // ═══════════════════════════════════════════════
    //  UNIT: updateActiveRoot
    // ═══════════════════════════════════════════════

    function test_UpdateActiveRoot_OnlyIssuer() public {
        vm.prank(attacker);
        vm.expectRevert(OnlyIssuer.selector);
        registry.updateActiveRoot(keccak256("root"));
    }

    function test_UpdateActiveRoot_RevertsOnZero() public {
        vm.prank(issuer1);
        vm.expectRevert(RootCannotBeZero.selector);
        registry.updateActiveRoot(bytes32(0));
    }

    function test_UpdateActiveRoot_Works() public {
        bytes32 root = keccak256("new-root");
        vm.prank(issuer1);
        vm.expectEmit(true, true, true, true);
        emit ActiveRootUpdated(root);
        registry.updateActiveRoot(root);
        assertEq(registry.activeRoot(), root);
    }

    function test_UpdateActiveRoot_WhenPaused_Reverts() public {
        vm.prank(owner);
        registry.pause();
        vm.prank(issuer1);
        vm.expectRevert();
        registry.updateActiveRoot(keccak256("root"));
    }

    function test_UpdateActiveRoot_MultipleUpdates() public {
        bytes32 root1 = keccak256("root1");
        bytes32 root2 = keccak256("root2");
        vm.prank(issuer1);
        registry.updateActiveRoot(root1);
        vm.prank(issuer1);
        registry.updateActiveRoot(root2);
        assertEq(registry.activeRoot(), root2);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: updateRevokedSecretRoot
    // ═══════════════════════════════════════════════

    function test_UpdateRevokedRoot_OnlyIssuer() public {
        vm.prank(attacker);
        vm.expectRevert(OnlyIssuer.selector);
        registry.updateRevokedSecretRoot(keccak256("root"));
    }

    function test_UpdateRevokedRoot_RevertsOnZero() public {
        vm.prank(issuer1);
        vm.expectRevert(RootCannotBeZero.selector);
        registry.updateRevokedSecretRoot(bytes32(0));
    }

    function test_UpdateRevokedRoot_Works() public {
        bytes32 root = keccak256("revoked-root");
        vm.prank(issuer1);
        vm.expectEmit(true, true, true, true);
        emit RevokedSecretRootUpdated(root);
        registry.updateRevokedSecretRoot(root);
        assertEq(registry.revokedSecretRoot(), root);
    }

    function test_UpdateRevokedRoot_WhenPaused_Reverts() public {
        vm.prank(owner);
        registry.pause();
        vm.prank(issuer1);
        vm.expectRevert();
        registry.updateRevokedSecretRoot(keccak256("root"));
    }

    // ═══════════════════════════════════════════════
    //  UNIT: markNullifierUsed
    // ═══════════════════════════════════════════════

    function test_MarkNullifier_OnlySessionManager() public {
        vm.prank(attacker);
        vm.expectRevert(OnlySessionManager.selector);
        registry.markNullifierUsed(keccak256("n"));
    }

    function test_MarkNullifier_RevertsOnReuse() public {
        bytes32 nullifier = keccak256("n1");
        vm.prank(sessionManager1);
        registry.markNullifierUsed(nullifier);
        vm.prank(sessionManager1);
        vm.expectRevert(NullifierUsed.selector);
        registry.markNullifierUsed(nullifier);
    }

    function test_MarkNullifier_Works() public {
        bytes32 nullifier = keccak256("n2");
        vm.prank(sessionManager1);
        registry.markNullifierUsed(nullifier);
        assertTrue(registry.usedNullifiers(nullifier));
        assertTrue(registry.isNullifierUsed(nullifier));
    }

    function test_MarkNullifier_StillWorksWhenPaused() public {
        vm.prank(owner);
        registry.pause();
        bytes32 nullifier = keccak256("n-paused");
        vm.prank(sessionManager1);
        registry.markNullifierUsed(nullifier);
        assertTrue(registry.isNullifierUsed(nullifier));
    }

    function test_MarkNullifier_CannotBeReusedByOtherSM() public {
        bytes32 nullifier = keccak256("n-shared");
        vm.prank(owner);
        registry.setSessionManager(sessionManager2, true);
        vm.prank(sessionManager1);
        registry.markNullifierUsed(nullifier);
        vm.prank(sessionManager2);
        vm.expectRevert(NullifierUsed.selector);
        registry.markNullifierUsed(nullifier);
    }

    function test_IsNullifierUsed_ReturnsFalseForUnused() public {
        assertFalse(registry.isNullifierUsed(keccak256("unused")));
    }

    // ═══════════════════════════════════════════════
    //  FUZZ
    // ═══════════════════════════════════════════════

    function testFuzz_NullifierMark(bytes32 nullifier) public {
        vm.assume(nullifier != bytes32(0));
        vm.prank(sessionManager1);
        registry.markNullifierUsed(nullifier);
        assertTrue(registry.isNullifierUsed(nullifier));
        vm.prank(sessionManager1);
        vm.expectRevert(NullifierUsed.selector);
        registry.markNullifierUsed(nullifier);
    }

    function testFuzz_MultipleNullifiers(bytes32[10] calldata nullifiers) public {
        for (uint256 i = 0; i < 10; i++) {
            bytes32 n = nullifiers[i];
            vm.prank(sessionManager1);
            registry.markNullifierUsed(n);
            assertTrue(registry.isNullifierUsed(n));
        }
        for (uint256 i = 0; i < 10; i++) {
            bytes32 n = nullifiers[i];
            vm.prank(sessionManager1);
            vm.expectRevert(NullifierUsed.selector);
            registry.markNullifierUsed(n);
        }
    }

    function testFuzz_ActiveRoot(bytes32 root) public {
        vm.assume(root != bytes32(0));
        vm.prank(issuer1);
        registry.updateActiveRoot(root);
        assertEq(registry.activeRoot(), root);
    }

    function testFuzz_RevokedRoot(bytes32 root) public {
        vm.assume(root != bytes32(0));
        vm.prank(issuer1);
        registry.updateRevokedSecretRoot(root);
        assertEq(registry.revokedSecretRoot(), root);
    }

    // ═══════════════════════════════════════════════
    //  INVARIANT
    // ═══════════════════════════════════════════════

    function test_Invariant_NullifierNeverClears() public {
        bytes32 nullifier = keccak256("persistent");
        vm.prank(sessionManager1);
        registry.markNullifierUsed(nullifier);
        assertTrue(registry.isNullifierUsed(nullifier));
        // Even after time passes
        vm.warp(block.timestamp + 1000 days);
        assertTrue(registry.isNullifierUsed(nullifier));
    }

    function test_Invariant_OnlyIssuersUpdateRoots() public {
        address[] memory attackers = new address[](3);
        attackers[0] = attacker;
        attackers[1] = random;
        attackers[2] = sessionManager1;
        for (uint256 i = 0; i < attackers.length; i++) {
            vm.prank(attackers[i]);
            vm.expectRevert();
            registry.updateActiveRoot(keccak256("root"));
        }
    }

    function test_Invariant_NullifierCrossSessionManager() public {
        bytes32 n = keccak256("cross-sm");
        vm.prank(sessionManager1);
        registry.markNullifierUsed(n);
        assertTrue(registry.isNullifierUsed(n));
        // sessionManager2 tries (not authorized yet)
        vm.prank(sessionManager2);
        vm.expectRevert(OnlySessionManager.selector);
        registry.markNullifierUsed(keccak256("other"));
        // After authorizing sessionManager2, it can't reuse the same nullifier
        vm.prank(owner);
        registry.setSessionManager(sessionManager2, true);
        vm.prank(sessionManager2);
        vm.expectRevert(NullifierUsed.selector);
        registry.markNullifierUsed(n);
    }

    // ═══════════════════════════════════════════════
    //  ADVERSARIAL
    // ═══════════════════════════════════════════════

    function test_Adversarial_FrontrunNullifier() public {
        bytes32 nullifier = keccak256("frontrun");
        // Attacker with sessionManager role marks first
        vm.prank(owner);
        registry.setSessionManager(attacker, true);
        vm.prank(attacker);
        registry.markNullifierUsed(nullifier);
        // Legit SessionManager can't use it
        vm.prank(sessionManager1);
        vm.expectRevert(NullifierUsed.selector);
        registry.markNullifierUsed(nullifier);
    }

    function test_Adversarial_ZeroNullifier() public {
        vm.prank(sessionManager1);
        registry.markNullifierUsed(bytes32(0));
        assertTrue(registry.isNullifierUsed(bytes32(0)));
    }

    function test_Adversarial_DirectImplCall() public {
        vm.prank(attacker);
        vm.expectRevert();
        CredentialRegistry(impl).updateActiveRoot(keccak256("impl-attack"));
    }

    function test_Adversarial_PausedStateISOLATION() public {
        // Even when paused, nullifier marking should work
        bytes32 root1 = keccak256("root-paused");
        vm.prank(owner);
        registry.addIssuer(issuer1);
        vm.prank(issuer1);
        registry.updateActiveRoot(root1);

        vm.prank(owner);
        registry.pause();

        // Root updates blocked
        vm.prank(issuer1);
        vm.expectRevert();
        registry.updateActiveRoot(keccak256("root2"));

        // But nullifiers still work
        bytes32 n = keccak256("n-paused-state");
        vm.prank(sessionManager1);
        registry.markNullifierUsed(n);
        assertTrue(registry.isNullifierUsed(n));
    }

    function test_Adversarial_RemoveThenReAddIssuer() public {
        vm.prank(owner);
        registry.removeIssuer(issuer1);
        assertFalse(registry.issuers(issuer1));
        vm.prank(issuer1);
        vm.expectRevert(OnlyIssuer.selector);
        registry.updateActiveRoot(keccak256("root"));

        vm.prank(owner);
        registry.addIssuer(issuer1);
        assertTrue(registry.issuers(issuer1));
        vm.prank(issuer1);
        registry.updateActiveRoot(keccak256("root"));
    }

    function test_Adversarial_MassNullifierFlood() public {
        for (uint256 i = 0; i < 100; i++) {
            vm.prank(sessionManager1);
            registry.markNullifierUsed(bytes32(uint256(i + 1)));
        }
        for (uint256 i = 0; i < 100; i++) {
            assertTrue(registry.isNullifierUsed(bytes32(uint256(i + 1))));
        }
    }
}
