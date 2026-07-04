// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./utils/AuditHarness.sol";

contract Phase08_SessionAbuse is AuditHarness {
    function test_DuplicateSessionIds_Revert() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        bytes32 sid = keccak256("dup-id");
        _createLightSession(w, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0));
        vm.expectRevert();
        _createLightSession(w, sid, sessionKey2, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0));
    }

    function test_MultipleRevocations_SecondRevert() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        bytes32 sid = keccak256("multi-revoke");
        _createLightSession(w, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0));
        vm.prank(w);
        sm.call(abi.encodeWithSignature("revokeLightweightSession(bytes32,address)", sid, w));
        vm.prank(w);
        (bool ok,) = sm.call(abi.encodeWithSignature("revokeLightweightSession(bytes32,address)", sid, w));
        assertFalse(ok);
    }

    function test_UnauthorizedRevoke_Reverts() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        bytes32 sid = keccak256("unauth-revoke");
        _createLightSession(w, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0));
        vm.prank(attacker);
        (bool ok,) = sm.call(abi.encodeWithSignature("revokeLightweightSession(bytes32,address)", sid, w));
        assertFalse(ok);
    }

    function test_SessionKey_CanRevokeOwnSession() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        bytes32 sid = keccak256("sk-revoke");
        _createLightSession(w, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0));
        vm.prank(sessionKey1);
        sm.call(abi.encodeWithSignature("revokeLightweightSession(bytes32,address)", sid, w));
        (,,,,,,, bool revoked) = _getLightSession(sid);
        assertTrue(revoked);
    }

    function test_CrossWalletSessionReplay_Reverts() public {
        address w1 = _createWallet(owner1);
        address w2 = _createWallet(owner2);
        vm.deal(w1, 1 ether);
        bytes32 sid = keccak256("cross-wallet");
        _createLightSession(w1, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0));
        vm.startPrank(w2);
        (bool ok,) = sm.call(abi.encodeWithSignature(
            "validateLightweightSession(bytes32,address,uint256,address)", sid, sessionKey1, 0.01 ether, address(0xBEEF)
        ));
        assertFalse(ok);
        vm.stopPrank();
    }

    function test_SpendLimitAccumulation() public {
        address w = _createWallet(owner1);
        vm.deal(w, 10 ether);
        bytes32 sid = keccak256("accum");
        _createLightSession(w, sid, sessionKey1, 1 ether, 1000, uint64(block.timestamp + 1 hours), new address[](0));
        vm.startPrank(w);
        _smCall(abi.encodeWithSignature("validateLightweightSession(bytes32,address,uint256,address)", sid, sessionKey1, 0.3 ether, address(0xBEEF)));
        _smCall(abi.encodeWithSignature("validateLightweightSession(bytes32,address,uint256,address)", sid, sessionKey1, 0.3 ether, address(0xBEEF)));
        (,,,,, uint256 dSpend,,) = _getLightSession(sid);
        assertEq(dSpend, 0.6 ether);
        _smCall(abi.encodeWithSignature("validateLightweightSession(bytes32,address,uint256,address)", sid, sessionKey1, 0.3 ether, address(0xBEEF)));
        (,,,,, dSpend,,) = _getLightSession(sid);
        assertEq(dSpend, 0.9 ether);
        (bool ok,) = sm.call(abi.encodeWithSignature(
            "validateLightweightSession(bytes32,address,uint256,address)", sid, sessionKey1, 0.2 ether, address(0xBEEF)
        ));
        assertFalse(ok);
        vm.stopPrank();
    }

    function test_WrongSigner_Reverts() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        bytes32 sid = keccak256("wrong-signer");
        _createLightSession(w, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0));
        vm.startPrank(w);
        (bool ok,) = sm.call(abi.encodeWithSignature(
            "validateLightweightSession(bytes32,address,uint256,address)", sid, sessionKey2, 0.01 ether, address(0xBEEF)
        ));
        assertFalse(ok);
        vm.stopPrank();
    }

    function test_SessionType_StandardVsLightweight() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        bytes32 lightSid = keccak256("light-type");
        _createLightSession(w, lightSid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0));
        assertEq(_getSessionType(lightSid), 1);
        assertEq(_getSessionType(keccak256("nonexistent")), 2);
    }

    function test_MaxTargets_Enforced() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        bytes32 sid = keccak256("max-targets");
        address[] memory targets = new address[](33);
        for (uint256 i = 0; i < 33; i++) {
            targets[i] = address(uint160(0xBEEF + i));
        }
        vm.expectRevert();
        _createLightSession(w, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), targets);
    }

    function test_RevokeDuringSession_Works() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        bytes32 sid = keccak256("revoke-during");
        _createLightSession(w, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0));
        vm.startPrank(w);
        _smCall(abi.encodeWithSignature("validateLightweightSession(bytes32,address,uint256,address)", sid, sessionKey1, 0.1 ether, address(0xBEEF)));
        _smCall(abi.encodeWithSignature("revokeLightweightSession(bytes32,address)", sid, w));
        (bool ok,) = sm.call(abi.encodeWithSignature(
            "validateLightweightSession(bytes32,address,uint256,address)", sid, sessionKey1, 0.1 ether, address(0xBEEF)
        ));
        assertFalse(ok);
        vm.stopPrank();
    }
}
