// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../src/DelegationManager.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract Audit07_DelegationManager is Test {
    DelegationManager internal dm;
    address internal owner;
    address internal delegator1;
    address internal delegator2;
    address internal delegate1;
    address internal delegate2;
    address internal attacker;

    bytes32 internal constant ROOT_UPDATER_ROLE = keccak256("ROOT_UPDATER");

    function setUp() public {
        owner = makeAddr("owner");
        delegator1 = makeAddr("delegator1");
        delegator2 = makeAddr("delegator2");
        delegate1 = makeAddr("delegate1");
        delegate2 = makeAddr("delegate2");
        attacker = makeAddr("attacker");

        address impl = address(new DelegationManager());
        dm = DelegationManager(address(new ERC1967Proxy(impl, abi.encodeWithSignature("initialize(address)", owner))));

        vm.prank(owner);
        dm.setRootUpdater(delegator1, true);
        vm.prank(owner);
        dm.setRootUpdater(delegator2, true);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: Initialization
    // ═══════════════════════════════════════════════

    function test_Initialize_SetsAdmin() public {
        assertTrue(dm.hasRole(dm.DEFAULT_ADMIN_ROLE(), owner));
    }

    function test_Initialize_SetsRootUpdater() public {
        assertTrue(dm.hasRole(ROOT_UPDATER_ROLE, owner));
    }

    function test_CannotReinitialize() public {
        vm.expectRevert();
        dm.initialize(attacker);
    }

    function test_Pause_OnlyAdmin() public {
        vm.prank(attacker);
        vm.expectRevert();
        dm.pause();
    }

    // ═══════════════════════════════════════════════
    //  UNIT: setRootUpdater
    // ═══════════════════════════════════════════════

    function test_SetRootUpdater_OnlyAdmin() public {
        vm.prank(attacker);
        vm.expectRevert();
        dm.setRootUpdater(delegate1, true);
    }

    function test_SetRootUpdater_GrantAndRevoke() public {
        vm.prank(owner);
        dm.setRootUpdater(delegate1, true);
        assertTrue(dm.hasRole(ROOT_UPDATER_ROLE, delegate1));
        vm.prank(owner);
        dm.setRootUpdater(delegate1, false);
        assertFalse(dm.hasRole(ROOT_UPDATER_ROLE, delegate1));
    }

    // ═══════════════════════════════════════════════
    //  UNIT: registerScope
    // ═══════════════════════════════════════════════

    function test_RegisterScope_OnlyAdmin() public {
        vm.prank(attacker);
        vm.expectRevert();
        dm.registerScope("test_action");
    }

    function test_RegisterScope_Duplicate() public {
        vm.prank(owner);
        dm.registerScope("scope");
        vm.prank(owner);
        vm.expectRevert(ScopeAlreadyRegistered.selector);
        dm.registerScope("scope");
    }

    function test_RegisterScope_Works() public {
        vm.prank(owner);
        dm.registerScope("transfer_assets");
        bytes32 scopeHash = keccak256(abi.encodePacked("transfer_assets"));
        assertEq(dm.getScopeAction(scopeHash), "transfer_assets");
    }

    // ═══════════════════════════════════════════════
    //  UNIT: updateDelegationRoot
    // ═══════════════════════════════════════════════

    function test_UpdateDelegationRoot_AsDelegator() public {
        bytes32 scopeHash = keccak256(abi.encodePacked("action"));
        bytes32 root = keccak256("root1");
        vm.prank(delegator1);
        dm.updateDelegationRoot(delegator1, scopeHash, root, 0);

        (bytes32 storedRoot, uint64 exp,) = dm.getDelegationRoot(delegator1, scopeHash);
        assertEq(storedRoot, root);
        assertEq(exp, 0);
    }

    function test_UpdateDelegationRoot_AsRootUpdater() public {
        bytes32 scopeHash = keccak256(abi.encodePacked("action"));
        bytes32 root = keccak256("root2");
        vm.prank(owner);
        dm.updateDelegationRoot(delegator1, scopeHash, root, 0);
        (bytes32 sr,,) = dm.getDelegationRoot(delegator1, scopeHash);
        assertEq(sr, root);
    }

    function test_UpdateDelegationRoot_RevokedDelegator() public {
        vm.prank(owner);
        dm.emergencyRevokeAll(delegator1);
        bytes32 scopeHash = keccak256(abi.encodePacked("action"));
        vm.prank(delegator1);
        vm.expectRevert(DelegatorHasBeenRevoked.selector);
        dm.updateDelegationRoot(delegator1, scopeHash, keccak256("root"), 0);
    }

    function test_UpdateDelegationRoot_Unauthorized() public {
        vm.prank(attacker);
        vm.expectRevert();
        dm.updateDelegationRoot(delegator1, keccak256(abi.encodePacked("a")), keccak256("r"), 0);
    }

    function test_UpdateDelegationRoot_ScopeLimitExceeded() public {
        for (uint256 i = 0; i < 32; i++) {
            vm.prank(delegator1);
            dm.updateDelegationRoot(delegator1, keccak256(abi.encode(i)), keccak256("root"), 0);
        }
        vm.prank(delegator1);
        vm.expectRevert(ScopeLimitExceeded.selector);
        dm.updateDelegationRoot(delegator1, keccak256("overflow"), keccak256("root"), 0);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: revokeDelegation
    // ═══════════════════════════════════════════════

    function test_RevokeDelegation_AsDelegator() public {
        bytes32 leaf = keccak256("leaf");
        vm.prank(delegator1);
        dm.revokeDelegation(leaf, delegator1);
        assertTrue(dm.isRevoked(leaf));
    }

    function test_RevokeDelegation_AsAdmin() public {
        bytes32 leaf = keccak256("leaf");
        vm.prank(owner);
        dm.revokeDelegation(leaf, delegator1);
        assertTrue(dm.isRevoked(leaf));
    }

    function test_RevokeDelegation_Unauthorized() public {
        vm.prank(attacker);
        vm.expectRevert();
        dm.revokeDelegation(keccak256("leaf"), delegator1);
    }

    function test_RevokeDelegation_AlreadyRevoked() public {
        bytes32 leaf = keccak256("leaf");
        vm.prank(delegator1);
        dm.revokeDelegation(leaf, delegator1);
        vm.prank(delegator1);
        vm.expectRevert(AlreadyRevokedDelegation.selector);
        dm.revokeDelegation(leaf, delegator1);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: emergencyRevokeAll / reAuthorizeDelegator
    // ═══════════════════════════════════════════════

    function test_EmergencyRevoke_OnlyAdmin() public {
        vm.prank(attacker);
        vm.expectRevert();
        dm.emergencyRevokeAll(delegator1);
    }

    function test_EmergencyRevoke_Works() public {
        vm.prank(owner);
        dm.emergencyRevokeAll(delegator1);
        assertTrue(dm.revokedDelegators(delegator1));
    }

    function test_ReAuthorizeDelegator_OnlyAdmin() public {
        vm.prank(owner);
        dm.emergencyRevokeAll(delegator1);
        vm.prank(attacker);
        vm.expectRevert();
        dm.reAuthorizeDelegator(delegator1);
    }

    function test_ReAuthorizeDelegator_ClearsRoots() public {
        bytes32 scopeHash = keccak256(abi.encodePacked("s1"));
        vm.prank(delegator1);
        dm.updateDelegationRoot(delegator1, scopeHash, keccak256("root"), 0);
        (bytes32 r,,) = dm.getDelegationRoot(delegator1, scopeHash);
        assertTrue(r != bytes32(0));

        vm.prank(owner);
        dm.emergencyRevokeAll(delegator1);
        vm.prank(owner);
        dm.reAuthorizeDelegator(delegator1);
        assertFalse(dm.revokedDelegators(delegator1));
        (r,,) = dm.getDelegationRoot(delegator1, scopeHash);
        assertEq(r, bytes32(0));
    }

    // ═══════════════════════════════════════════════
    //  UNIT: verifyDelegation (single-hop)
    // ═══════════════════════════════════════════════

    function test_VerifyDelegation_NoRoot() public {
        bytes32 leaf = keccak256(abi.encode(delegator1, delegate1, keccak256(abi.encodePacked("scope")), uint64(0)));
        bytes32[] memory proof = new bytes32[](0);
        // No root set
        bool ok = dm.verifyDelegation(leaf, proof, delegator1, keccak256(abi.encodePacked("scope")), 0, 10);
        assertFalse(ok);
    }

    function test_VerifyDelegation_RevokedDelegator() public {
        vm.prank(owner);
        dm.emergencyRevokeAll(delegator1);
        bytes32 leaf = keccak256(abi.encode(delegator1, delegate1, keccak256(abi.encodePacked("scope")), uint64(0)));
        bytes32[] memory proof = new bytes32[](0);
        bool ok = dm.verifyDelegation(leaf, proof, delegator1, keccak256(abi.encodePacked("scope")), 0, 10);
        assertFalse(ok);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: verifyDelegationChain
    // ═══════════════════════════════════════════════

    function test_VerifyDelegationChain_Empty() public {
        vm.expectRevert(EmptyChain.selector);
        dm.verifyDelegationChain(new bytes32[](0), new bytes32[][](0), new address[](0), new address[](0), new bytes32[](0), new uint64[](0), new uint8[](0));
    }

    function test_VerifyDelegationChain_TooLong() public {
        uint256 len = 11;
        bytes32[] memory leaves = new bytes32[](len);
        bytes32[][] memory proofs = new bytes32[][](len);
        address[] memory delegators = new address[](len);
        address[] memory delegates = new address[](len);
        bytes32[] memory scopes = new bytes32[](len);
        uint64[] memory expiries = new uint64[](len);
        uint8[] memory maxDepths = new uint8[](len);
        vm.prank(owner);
        vm.expectRevert(ChainTooLong.selector);
        dm.verifyDelegationChain(leaves, proofs, delegators, delegates, scopes, expiries, maxDepths);
    }

    function test_VerifyDelegationChain_LengthMismatch() public {
        bytes32[] memory leaves = new bytes32[](1);
        bytes32[][] memory proofs = new bytes32[][](1);
        address[] memory delegators = new address[](2);
        address[] memory delegates = new address[](1);
        bytes32[] memory scopes = new bytes32[](1);
        uint64[] memory expiries = new uint64[](1);
        uint8[] memory maxDepths = new uint8[](1);
        vm.prank(owner);
        vm.expectRevert(ArrayLengthMismatch.selector);
        dm.verifyDelegationChain(leaves, proofs, delegators, delegates, scopes, expiries, maxDepths);
    }

    // ═══════════════════════════════════════════════
    //  FUZZ
    // ═══════════════════════════════════════════════

    function testFuzz_UpdateAndQueryRoot(bytes32 scopeAction, bytes32 root) public {
        vm.assume(root != bytes32(0));
        bytes32 scopeHash = keccak256(abi.encodePacked(scopeAction));
        vm.prank(delegator1);
        dm.updateDelegationRoot(delegator1, scopeHash, root, 0);
        (bytes32 sr,,) = dm.getDelegationRoot(delegator1, scopeHash);
        assertEq(sr, root);
    }

    function testFuzz_RevokeLeaf(bytes32 leaf) public {
        vm.prank(delegator1);
        dm.revokeDelegation(leaf, delegator1);
        assertTrue(dm.isRevoked(leaf));
    }

    // ═══════════════════════════════════════════════
    //  INVARIANT
    // ═══════════════════════════════════════════════

    function test_Invariant_RevokedDelegatorBlocksAllRoots() public {
        bytes32 scopeHash = keccak256(abi.encodePacked("s1"));
        vm.prank(delegator1);
        dm.updateDelegationRoot(delegator1, scopeHash, keccak256("root"), 0);
        vm.prank(owner);
        dm.emergencyRevokeAll(delegator1);
        bytes32 leaf = keccak256(abi.encode(delegator1, delegate1, scopeHash, uint64(0)));
        bytes32[] memory proof = new bytes32[](0);
        bool ok = dm.verifyDelegation(leaf, proof, delegator1, scopeHash, 0, 10);
        assertFalse(ok);
    }

    function test_Invariant_ReAuthorizeClearsAll() public {
        vm.prank(delegator1);
        dm.updateDelegationRoot(delegator1, keccak256(abi.encodePacked("a")), keccak256("r1"), 0);
        vm.prank(delegator1);
        dm.updateDelegationRoot(delegator1, keccak256(abi.encodePacked("b")), keccak256("r2"), 0);
        vm.prank(owner);
        dm.emergencyRevokeAll(delegator1);
        vm.prank(owner);
        dm.reAuthorizeDelegator(delegator1);
        (bytes32 r1,,) = dm.getDelegationRoot(delegator1, keccak256(abi.encodePacked("a")));
        (bytes32 r2,,) = dm.getDelegationRoot(delegator1, keccak256(abi.encodePacked("b")));
        assertEq(r1, bytes32(0));
        assertEq(r2, bytes32(0));
        assertFalse(dm.revokedDelegators(delegator1));
    }

    // ═══════════════════════════════════════════════
    //  ADVERSARIAL
    // ═══════════════════════════════════════════════

    function test_Adversarial_ExpiredRoot() public {
        bytes32 scopeHash = keccak256(abi.encodePacked("exp-scope"));
        vm.prank(delegator1);
        dm.updateDelegationRoot(delegator1, scopeHash, keccak256("root"), uint64(block.timestamp + 100));
        vm.warp(block.timestamp + 200);
        bytes32 leaf = keccak256(abi.encode(delegator1, delegate1, scopeHash, uint64(0)));
        bytes32[] memory proof = new bytes32[](0);
        bool ok = dm.verifyDelegation(leaf, proof, delegator1, scopeHash, 0, 10);
        assertFalse(ok);
    }

    function test_Adversarial_DepthExceeded() public {
        bytes32 scopeHash = keccak256(abi.encodePacked("s"));
        vm.prank(delegator1);
        dm.updateDelegationRoot(delegator1, scopeHash, keccak256("root"), 0);
        bytes32 leaf = keccak256(abi.encode(delegator1, delegate1, scopeHash, uint64(0)));
        bytes32[] memory proof = new bytes32[](0);
        bool ok = dm.verifyDelegation(leaf, proof, delegator1, scopeHash, 0, 0); // maxDepth=0, currentDepth=1
        assertFalse(ok);
    }

    function test_Adversarial_ChainContinuityBreak() public {
        // Setup: delegator1 -> delegate1 -> delegate2 chain
        // If intermediate hop doesn't connect, chain fails
        bytes32[] memory leaves = new bytes32[](2);
        bytes32[][] memory proofs = new bytes32[][](2);
        address[] memory delegators = new address[](2);
        address[] memory delegates = new address[](2);
        bytes32[] memory scopes = new bytes32[](2);
        uint64[] memory expiries = new uint64[](2);
        uint8[] memory maxDepths = new uint8[](2);

        bytes32 scopeHash = keccak256(abi.encodePacked("sc"));

        vm.prank(delegator1);
        dm.updateDelegationRoot(delegator1, scopeHash, keccak256("root1"), 0);

        // Hop 1: delegator1 -> delegate1 (correct)
        leaves[0] = keccak256(abi.encode(delegator1, delegate1, scopeHash, uint64(0)));
        proofs[0] = new bytes32[](0);
        delegators[0] = delegator1;
        delegates[0] = delegate1;
        scopes[0] = scopeHash;
        expiries[0] = 0;
        maxDepths[0] = 10;

        // Hop 2: says delegator2 (WRONG - should be delegate1) -> delegate2
        leaves[1] = keccak256(abi.encode(delegator2, delegate2, scopeHash, uint64(0)));
        proofs[1] = new bytes32[](0);
        delegators[1] = delegator2;
        delegates[1] = delegate2;
        scopes[1] = scopeHash;
        expiries[1] = 0;
        maxDepths[1] = 10;

        bool ok = dm.verifyDelegationChain(leaves, proofs, delegators, delegates, scopes, expiries, maxDepths);
        assertFalse(ok);
    }
}
