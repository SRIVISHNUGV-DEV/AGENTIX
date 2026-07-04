// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./utils/AuditHarness.sol";

contract RevertOnReceive {
    receive() external payable { revert("no"); }
    fallback() external payable { revert("no"); }
}

contract Phase09_WalletAbuse is AuditHarness {
    function test_Execute_AfterOwnershipChange_OldOwnerBlocked() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        vm.prank(owner1);
        w.call(abi.encodeWithSignature("changeOwner(address)", attacker));
        vm.prank(attacker);
        w.call(abi.encodeWithSignature("acceptOwnership()"));
        vm.prank(owner1);
        (bool ok,) = w.call(abi.encodeWithSignature("execute(address,uint256,bytes)", address(0xBEEF), 0, ""));
        assertFalse(ok);
    }

    function test_Execute_AfterSessionExpiry() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        bytes32 sid = keccak256("exec-expired");
        _createLightSession(w, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0));
        vm.warp(block.timestamp + 2 hours);
        vm.startPrank(w);
        (bool ok,) = sm.call(abi.encodeWithSignature(
            "validateLightweightSession(bytes32,address,uint256,address)", sid, sessionKey1, 0.01 ether, address(0xBEEF)
        ));
        assertFalse(ok);
        vm.stopPrank();
    }

    function test_Execute_AfterSessionRevocation() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        bytes32 sid = keccak256("exec-revoked");
        _createLightSession(w, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0));
        vm.prank(w);
        sm.call(abi.encodeWithSignature("revokeLightweightSession(bytes32,address)", sid, w));
        vm.startPrank(w);
        (bool ok,) = sm.call(abi.encodeWithSignature(
            "validateLightweightSession(bytes32,address,uint256,address)", sid, sessionKey1, 0.01 ether, address(0xBEEF)
        ));
        assertFalse(ok);
        vm.stopPrank();
    }

    function test_ExecuteBatch_MalformedInput_Reverts() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        address[] memory targets = new address[](1);
        targets[0] = address(0xBEEF);
        uint256[] memory values = new uint256[](2);
        values[0] = 0; values[1] = 0;
        bytes[] memory data = new bytes[](1);
        data[0] = "";
        vm.prank(owner1);
        (bool ok,) = w.call(abi.encodeWithSignature("executeBatch(address[],uint256[],bytes[])", targets, values, data));
        assertFalse(ok);
    }

    function test_ExecuteBatch_EmptyArrays_Reverts() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        address[] memory targets = new address[](0);
        uint256[] memory values = new uint256[](0);
        bytes[] memory data = new bytes[](0);
        vm.prank(owner1);
        (bool ok,) = w.call(abi.encodeWithSignature("executeBatch(address[],uint256[],bytes[])", targets, values, data));
        assertFalse(ok);
    }

    function test_ExecuteToRevertingContract() public {
        RevertOnReceive rr = new RevertOnReceive();
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        vm.prank(owner1);
        (bool ok,) = w.call(abi.encodeWithSignature("execute(address,uint256,bytes)", address(rr), 0, ""));
        assertFalse(ok);
    }

    function test_ExecuteBatchPartialFailure_Reverts() public {
        RevertOnReceive rr = new RevertOnReceive();
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        address[] memory targets = new address[](2);
        targets[0] = address(0xBEEF); targets[1] = address(rr);
        uint256[] memory values = new uint256[](2);
        bytes[] memory data = new bytes[](2);
        vm.prank(owner1);
        (bool ok,) = w.call(abi.encodeWithSignature("executeBatch(address[],uint256[],bytes[])", targets, values, data));
        assertFalse(ok);
    }

    function test_ProposeEntryPoint_TimelockEnforced() public {
        address w = _createWallet(owner1);
        vm.prank(owner1);
        w.call(abi.encodeWithSignature("proposeEntryPoint(address)", makeAddr("newEP")));
        vm.prank(owner1);
        (bool ok,) = w.call(abi.encodeWithSignature("acceptEntryPoint()"));
        assertFalse(ok);
        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(owner1);
        (bool ok2,) = w.call(abi.encodeWithSignature("acceptEntryPoint()"));
        assertTrue(ok2);
    }

    function test_IdentityLifecycle() public {
        address w = _createWallet(owner1);
        (bool ok, bytes memory ret) = identity.staticcall(abi.encodeWithSignature("identityOf(address)", w));
        require(ok);
        uint256 id = abi.decode(ret, (uint256));
        assertTrue(id > 0);

        (bool ok2, bytes memory ret2) = identity.staticcall(abi.encodeWithSignature("isActive(uint256)", id));
        require(ok2);
        assertTrue(abi.decode(ret2, (bool)));

        vm.prank(owner1);
        identity.call(abi.encodeWithSignature("deactivate(uint256)", id));
        (bool ok3, bytes memory ret3) = identity.staticcall(abi.encodeWithSignature("isActive(uint256)", id));
        require(ok3);
        assertFalse(abi.decode(ret3, (bool)));

        vm.prank(owner1);
        identity.call(abi.encodeWithSignature("reactivate(uint256)", id));
        (bool ok4, bytes memory ret4) = identity.staticcall(abi.encodeWithSignature("isActive(uint256)", id));
        require(ok4);
        assertTrue(abi.decode(ret4, (bool)));
    }

    function test_LinkCredential() public {
        address w = _createWallet(owner1);
        (bool ok, bytes memory ret) = identity.staticcall(abi.encodeWithSignature("identityOf(address)", w));
        require(ok);
        uint256 id = abi.decode(ret, (uint256));
        vm.prank(owner1);
        identity.call(abi.encodeWithSignature("linkCredential(uint256,uint256)", id, 42));
        (bool ok2, bytes memory ret2) = identity.staticcall(abi.encodeWithSignature("credentialOf(uint256)", id));
        require(ok2);
        assertEq(abi.decode(ret2, (uint256)), 42);
    }
}
