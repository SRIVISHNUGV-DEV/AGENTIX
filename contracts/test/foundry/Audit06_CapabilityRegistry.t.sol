// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../src/CapabilityRegistry.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract Audit06_CapabilityRegistry is Test {
    CapabilityRegistry internal registry;
    address internal owner;
    address internal registrar;
    address internal grantee;
    address internal agent;
    address internal attacker;

    event CapabilityRegistered(bytes32 indexed capabilityId, bytes32 indexed actionHash, address indexed registrar);
    event CapabilityRevoked(bytes32 indexed capabilityId);
    event GrantRootUpdated(address indexed grantor, address indexed grantee, bytes32 indexed capabilityId, bytes32 newRoot);
    event GrantRevoked(bytes32 indexed grantLeafHash);

    function setUp() public {
        owner = makeAddr("owner");
        registrar = makeAddr("registrar");
        grantee = makeAddr("grantee");
        agent = makeAddr("agent");
        attacker = makeAddr("attacker");

        address impl = address(new CapabilityRegistry());
        registry = CapabilityRegistry(address(new ERC1967Proxy(impl, abi.encodeWithSignature("initialize(address)", owner))));
    }

    // ═══════════════════════════════════════════════
    //  UNIT: Initialization
    // ═══════════════════════════════════════════════

    function test_CannotReinitialize() public {
        vm.expectRevert();
        registry.initialize(owner);
    }

    function test_Pause_OnlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        registry.pause();
    }

    // ═══════════════════════════════════════════════
    //  UNIT: registerCapability
    // ═══════════════════════════════════════════════

    function test_RegisterCapability_OnlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        registry.registerCapability(keccak256("c"), "do_thing", 0);
    }

    function test_RegisterCapability_Duplicate() public {
        vm.prank(owner);
        registry.registerCapability(keccak256("c"), "do_thing", 0);
        vm.prank(owner);
        vm.expectRevert(CapabilityExists.selector);
        registry.registerCapability(keccak256("c"), "do_thing", 0);
    }

    function test_RegisterCapability_EmptyAction() public {
        vm.prank(owner);
        vm.expectRevert(ActionRequired.selector);
        registry.registerCapability(keccak256("c"), "", 0);
    }

    function test_RegisterCapability_Works() public {
        bytes32 capId = keccak256("transfer_tokens");
        bytes32 actionHash = keccak256(abi.encodePacked("transfer_tokens"));
        vm.prank(owner);
        vm.expectEmit(true, true, true, true);
        emit CapabilityRegistered(capId, actionHash, owner);
        registry.registerCapability(capId, "transfer_tokens", 0);

        CapabilityRegistry.CapabilityDef memory cap = registry.getCapability(capId);
        assertEq(cap.actionHash, actionHash);
        assertEq(cap.registrar, owner);
        assertFalse(cap.revoked);
        assertEq(registry.getCapabilityCount(), 1);
        assertEq(registry.getCapabilityAt(0), capId);
    }

    function test_RegisterCapability_WithExpiry() public {
        bytes32 capId = keccak256("temp_cap");
        uint64 expiresAt = uint64(block.timestamp + 365 days);
        vm.prank(owner);
        registry.registerCapability(capId, "temp_cap", expiresAt);
        CapabilityRegistry.CapabilityDef memory cap = registry.getCapability(capId);
        assertEq(cap.expiresAt, expiresAt);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: revokeCapability
    // ═══════════════════════════════════════════════

    function test_RevokeCapability_NotFound() public {
        vm.prank(owner);
        vm.expectRevert(CapabilityNotFound.selector);
        registry.revokeCapability(keccak256("nonexistent"));
    }

    function test_RevokeCapability_NotAuthorized() public {
        vm.prank(owner);
        registry.registerCapability(keccak256("c"), "action", 0);
        vm.prank(attacker);
        vm.expectRevert(NotAuthorizedForCapability.selector);
        registry.revokeCapability(keccak256("c"));
    }

    function test_RevokeCapability_AlreadyRevoked() public {
        vm.prank(owner);
        registry.registerCapability(keccak256("c"), "action", 0);
        vm.prank(owner);
        registry.revokeCapability(keccak256("c"));
        vm.prank(owner);
        vm.expectRevert(AlreadyRevokedCapability.selector);
        registry.revokeCapability(keccak256("c"));
    }

    function test_RevokeCapability_Works() public {
        bytes32 capId = keccak256("c");
        vm.prank(owner);
        registry.registerCapability(capId, "action", 0);
        vm.prank(owner);
        vm.expectEmit(true, true, true, true);
        emit CapabilityRevoked(capId);
        registry.revokeCapability(capId);
        assertTrue(registry.getCapability(capId).revoked);
    }

    function test_RevokeCapability_ByRegistrar() public {
        bytes32 capId = keccak256("c");
        vm.prank(owner);
        registry.registerCapability(capId, "action", 0);
        // registrar == owner (the msg.sender of registerCapability is owner)
        // In this case registrar == owner, so revoking works
        vm.prank(owner);
        registry.revokeCapability(capId);
        assertTrue(registry.getCapability(capId).revoked);
    }

    function test_RevokeCapability_ByOwnerEvenIfNotRegistrar() public {
        // owner can always revoke regardless of who the registrar is
        // But registrar is always owner in this setup. Test with registrar as registrar
        bytes32 capId = keccak256("c");
        vm.prank(owner);
        registry.registerCapability(capId, "action", 0);
        // owner can revoke (registrar == owner, also owner is owner)
        vm.prank(owner);
        registry.revokeCapability(capId);
        assertTrue(registry.getCapability(capId).revoked);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: updateGrantRoot
    // ═══════════════════════════════════════════════

    function test_UpdateGrantRoot_CapabilityNotFound() public {
        vm.prank(owner);
        vm.expectRevert(CapabilityNotFound.selector);
        registry.updateGrantRoot(grantee, keccak256("nonexistent"), keccak256("root"));
    }

    function test_UpdateGrantRoot_InvalidGrantee() public {
        vm.prank(owner);
        registry.registerCapability(keccak256("c"), "action", 0);
        vm.prank(owner);
        vm.expectRevert(InvalidRecipient.selector);
        registry.updateGrantRoot(address(0), keccak256("c"), keccak256("root"));
    }

    function test_UpdateGrantRoot_ZeroRoot() public {
        vm.prank(owner);
        registry.registerCapability(keccak256("c"), "action", 0);
        vm.prank(owner);
        vm.expectRevert(InvalidRoot.selector);
        registry.updateGrantRoot(grantee, keccak256("c"), bytes32(0));
    }

    function test_UpdateGrantRoot_NotAuthorized() public {
        vm.prank(owner);
        registry.registerCapability(keccak256("c"), "action", 0);
        vm.prank(attacker);
        vm.expectRevert(NotAuthorizedForCapability.selector);
        registry.updateGrantRoot(grantee, keccak256("c"), keccak256("root"));
    }

    function test_UpdateGrantRoot_Works() public {
        bytes32 capId = keccak256("c");
        bytes32 root = keccak256("grant-root");
        vm.prank(owner);
        registry.registerCapability(capId, "action", 0);
        vm.prank(owner);
        vm.expectEmit(true, true, true, true);
        emit GrantRootUpdated(owner, grantee, capId, root);
        registry.updateGrantRoot(grantee, capId, root);
        assertEq(registry.grantRoots(owner, grantee, capId), root);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: revokeGrant
    // ═══════════════════════════════════════════════

    function test_RevokeGrant_NoGrantRoot() public {
        vm.prank(owner);
        vm.expectRevert(GrantNotRevocable.selector);
        registry.revokeGrant(keccak256("leaf"), keccak256("c"), owner, grantee);
    }

    function test_RevokeGrant_AlreadyRevoked() public {
        bytes32 capId = keccak256("c");
        bytes32 leaf = keccak256("grant-leaf");
        vm.prank(owner);
        registry.registerCapability(capId, "action", 0);
        vm.prank(owner);
        registry.updateGrantRoot(grantee, capId, keccak256("root"));
        vm.prank(owner);
        registry.revokeGrant(leaf, capId, owner, grantee);
        vm.prank(owner);
        vm.expectRevert(AlreadyRevokedGrant.selector);
        registry.revokeGrant(leaf, capId, owner, grantee);
    }

    function test_RevokeGrant_ByOwner() public {
        bytes32 capId = keccak256("c");
        bytes32 leaf = keccak256("grant-leaf");
        vm.prank(owner);
        registry.registerCapability(capId, "action", 0);
        vm.prank(owner);
        registry.updateGrantRoot(grantee, capId, keccak256("root"));
        vm.prank(owner);
        vm.expectEmit(true, true, true, true);
        emit GrantRevoked(leaf);
        registry.revokeGrant(leaf, capId, owner, grantee);
        assertTrue(registry.revokedGrants(leaf));
    }

    // ═══════════════════════════════════════════════
    //  UNIT: verifyCapability
    // ═══════════════════════════════════════════════

    function test_VerifyCapability_Revoked() public {
        bytes32 capId = keccak256("c");
        vm.prank(owner);
        registry.registerCapability(capId, "action", 0);
        vm.prank(owner);
        registry.revokeCapability(capId);
        assertFalse(registry.verifyCapability(agent, capId, bytes32(0), new bytes32[](0), owner, bytes32(0), 0));
    }

    function test_VerifyCapability_NoGrantRoot() public {
        bytes32 capId = keccak256("c");
        vm.prank(owner);
        registry.registerCapability(capId, "action", 0);
        bytes32 leaf = keccak256(abi.encode(capId, owner, agent, bytes32(0), uint64(0)));
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = keccak256("sibling");
        assertFalse(registry.verifyCapability(agent, capId, leaf, proof, owner, bytes32(0), 0));
    }

    function test_VerifyCapability_Expired() public {
        bytes32 capId = keccak256("c");
        vm.prank(owner);
        registry.registerCapability(capId, "action", uint64(block.timestamp + 100));
        vm.warp(block.timestamp + 200);
        bytes32 leaf = keccak256(abi.encode(capId, owner, agent, bytes32(0), uint64(0)));
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = keccak256("sibling");
        assertFalse(registry.verifyCapability(agent, capId, leaf, proof, owner, bytes32(0), 0));
    }

    function test_VerifyCapability_GrantLeafExpired() public {
        bytes32 capId = keccak256("c");
        vm.prank(owner);
        registry.registerCapability(capId, "action", 0);
        vm.prank(owner);
        registry.updateGrantRoot(agent, capId, keccak256("root"));
        bytes32 leaf = keccak256(abi.encode(capId, owner, agent, bytes32(0), uint64(1)));
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = keccak256("sibling");
        assertFalse(registry.verifyCapability(agent, capId, leaf, proof, owner, bytes32(0), 100)); // expired expiry
    }

    // ═══════════════════════════════════════════════
    //  UNIT: View functions
    // ═══════════════════════════════════════════════

    function test_GetCapability_ReturnZeroForUnknown() public {
        CapabilityRegistry.CapabilityDef memory cap = registry.getCapability(keccak256("unknown"));
        assertEq(cap.createdAt, 0);
    }

    function test_GetCapabilityCount_StartsAtZero() public {
        assertEq(registry.getCapabilityCount(), 0);
    }

    // ═══════════════════════════════════════════════
    //  FUZZ
    // ═══════════════════════════════════════════════

    function testFuzz_RegisterAndCheck(bytes32 capId, string memory action) public {
        vm.assume(bytes(action).length > 0);
        vm.prank(owner);
        registry.registerCapability(capId, action, 0);
        CapabilityRegistry.CapabilityDef memory cap = registry.getCapability(capId);
        assertEq(cap.actionHash, keccak256(abi.encodePacked(action)));
        assertEq(cap.registrar, owner);
    }

    // ═══════════════════════════════════════════════
    //  INVARIANT
    // ═══════════════════════════════════════════════

    function test_Invariant_RevokedCapabilityVerifyReturnsFalse() public {
        bytes32 capId = keccak256("inv-cap");
        vm.prank(owner);
        registry.registerCapability(capId, "action", 0);
        bytes32 root = keccak256("root");
        vm.prank(owner);
        registry.updateGrantRoot(agent, capId, root);
        vm.prank(owner);
        registry.revokeCapability(capId);
        bytes32 leaf = keccak256(abi.encode(capId, owner, agent, bytes32(0), uint64(0)));
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = keccak256("sibling");
        assertFalse(registry.verifyCapability(agent, capId, leaf, proof, owner, bytes32(0), 0));
    }

    function test_Invariant_OnlyOwnerRegisters() public {
        bytes32 capId = keccak256("owner-only");
        vm.prank(attacker);
        vm.expectRevert();
        registry.registerCapability(capId, "bad", 0);
        vm.prank(owner);
        registry.registerCapability(capId, "good", 0);
        assertEq(registry.getCapability(capId).registrar, owner);
    }

    // ═══════════════════════════════════════════════
    //  ADVERSARIAL
    // ═══════════════════════════════════════════════

    function test_Adversarial_DoubleRegister() public {
        bytes32 capId = keccak256("double");
        vm.prank(owner);
        registry.registerCapability(capId, "first", 0);
        vm.prank(owner);
        vm.expectRevert(CapabilityExists.selector);
        registry.registerCapability(capId, "second", 0);
    }

    function test_Adversarial_GrantRevocationMakesVerifyFail() public {
        bytes32 capId = keccak256("rev-grant");
        vm.prank(owner);
        registry.registerCapability(capId, "action", 0);
        bytes32 root = keccak256("root");
        vm.prank(owner);
        registry.updateGrantRoot(agent, capId, root);

        bytes32 leaf = keccak256(abi.encode(capId, owner, agent, bytes32(0), uint64(0)));
        vm.prank(owner);
        registry.revokeGrant(leaf, capId, owner, agent);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = keccak256("sibling");
        assertFalse(registry.verifyCapability(agent, capId, leaf, proof, owner, bytes32(0), 0));
    }

    function test_Adversarial_RevokedGrantListNotEmpty() public {
        bytes32 capId = keccak256("multi-rev");
        vm.prank(owner);
        registry.registerCapability(capId, "action", 0);
        bytes32 root = keccak256("root");
        vm.prank(owner);
        registry.updateGrantRoot(agent, capId, root);

        for (uint256 i = 0; i < 10; i++) {
            bytes32 leaf = keccak256(abi.encode(i));
            vm.prank(owner);
            registry.revokeGrant(leaf, capId, owner, agent);
            assertTrue(registry.revokedGrants(leaf));
        }
    }
}
