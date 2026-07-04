// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./utils/AuditHarness.sol";

contract Phase03_Invariants is AuditHarness {
    function invariant_walletCount_matchesIdentityCount() public view {
        (bool ok1, bytes memory ret1) = factory.staticcall(abi.encodeWithSignature("walletCount()"));
        (bool ok2, bytes memory ret2) = identity.staticcall(abi.encodeWithSignature("identityCount()"));
        require(ok1 && ok2);
        assertEq(abi.decode(ret1, (uint256)), abi.decode(ret2, (uint256)));
    }

    function invariant_everyIdentityHasWallet() public view {
        (bool ok, bytes memory ret) = identity.staticcall(abi.encodeWithSignature("identityCount()"));
        require(ok);
        uint256 count = abi.decode(ret, (uint256));
        for (uint256 i = 1; i <= count; i++) {
            (bool ok2, bytes memory ret2) = identity.staticcall(abi.encodeWithSignature("walletOf(uint256)", i));
            require(ok2);
            address w = abi.decode(ret2, (address));
            assertTrue(w != address(0));
        }
    }

    function invariant_walletOwnerExists() public view {
        (bool ok, bytes memory ret) = factory.staticcall(abi.encodeWithSignature("walletCount()"));
        require(ok);
        uint256 count = abi.decode(ret, (uint256));
        for (uint256 i = 0; i < count; i++) {
            bytes32 salt = keccak256(abi.encode(owner1, block.chainid, i));
            (bool ok2, bytes memory ret2) = factory.staticcall(abi.encodeWithSignature("getAddress(bytes32)", salt));
            require(ok2);
            address w = abi.decode(ret2, (address));
            (, bytes memory ownerRet) = w.staticcall(abi.encodeWithSignature("owner()"));
            address o = abi.decode(ownerRet, (address));
            assertTrue(o != address(0));
        }
    }

    function invariant_expiredSessionNeverValidates() public {
        address w = _createWallet(owner1);
        bytes32 sid = keccak256("expired-session");
        uint64 expiry = uint64(block.timestamp - 1);
        vm.deal(w, 1 ether);
        _createLightSession(w, sid, sessionKey1, 1 ether, 100, expiry, new address[](0));

        vm.startPrank(w);
        (bool ok,) = sm.call(abi.encodeWithSignature(
            "validateLightweightSession(bytes32,address,uint256,address)",
            sid, sessionKey1, 0.01 ether, address(0xBEEF)
        ));
        assertFalse(ok);
        vm.stopPrank();
    }

    function invariant_revokedSessionNeverValidates() public {
        address w = _createWallet(owner1);
        bytes32 sid = keccak256("revoked-session");
        vm.deal(w, 1 ether);
        _createLightSession(w, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0));

        vm.prank(w);
        (bool ok,) = sm.call(abi.encodeWithSignature("revokeLightweightSession(bytes32,address)", sid, w));
        require(ok);

        vm.startPrank(w);
        (bool ok2,) = sm.call(abi.encodeWithSignature(
            "validateLightweightSession(bytes32,address,uint256,address)",
            sid, sessionKey1, 0.01 ether, address(0xBEEF)
        ));
        assertFalse(ok2);
        vm.stopPrank();
    }

    function invariant_sessionIdUniqueness() public {
        address w = _createWallet(owner1);
        bytes32 sid1 = keccak256("unique-1");
        bytes32 sid2 = keccak256("unique-2");
        _createLightSession(w, sid1, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0));
        vm.deal(w, 1 ether);
        _createLightSession(w, sid2, sessionKey2, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0));
        assertEq(_getSessionType(sid1), 1);
        assertEq(_getSessionType(sid2), 1);
    }

    function invariant_duplicateSessionIdReverts() public {
        address w = _createWallet(owner1);
        bytes32 sid = keccak256("dup-session");
        vm.deal(w, 1 ether);
        _createLightSession(w, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0));
        vm.expectRevert();
        _createLightSession(w, sid, sessionKey2, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0));
    }

    function invariant_maxSessionsPerWalletEnforced() public {
        address w = _createWallet(owner1);
        vm.deal(w, 100 ether);
        for (uint256 i = 0; i < 100; i++) {
            bytes32 sid = keccak256(abi.encode("session", i));
            _createLightSession(w, sid, sessionKey1, 1 ether, 1, uint64(block.timestamp + 1 hours), new address[](0));
        }
        bytes32 overLimit = keccak256("over-limit");
        vm.expectRevert();
        _createLightSession(w, overLimit, sessionKey1, 1 ether, 1, uint64(block.timestamp + 1 hours), new address[](0));
    }

    function invariant_dailySpendResetOnNewDay() public {
        address w = _createWallet(owner1);
        bytes32 sid = keccak256("daily-reset");
        vm.deal(w, 10 ether);
        _createLightSession(w, sid, sessionKey1, 0.5 ether, 10, uint64(block.timestamp + 2 days), new address[](0));

        vm.startPrank(w);
        (bool ok1,) = sm.call(abi.encodeWithSignature(
            "validateLightweightSession(bytes32,address,uint256,address)",
            sid, sessionKey1, 0.4 ether, address(0xBEEF)
        ));
        require(ok1);

        (bool ok2,) = sm.call(abi.encodeWithSignature(
            "validateLightweightSession(bytes32,address,uint256,address)",
            sid, sessionKey1, 0.2 ether, address(0xBEEF)
        ));
        assertFalse(ok2);
        vm.stopPrank();

        vm.warp(block.timestamp + 1 days);
        vm.startPrank(w);
        (bool ok3,) = sm.call(abi.encodeWithSignature(
            "validateLightweightSession(bytes32,address,uint256,address)",
            sid, sessionKey1, 0.3 ether, address(0xBEEF)
        ));
        require(ok3);
        vm.stopPrank();

        (,,,,, uint256 dailySpendUsed,,) = _getLightSession(sid);
        assertEq(dailySpendUsed, 0.3 ether);
    }

    function invariant_pauseBlocksCreation() public {
        (bool ok,) = sm.call(abi.encodeWithSignature("pause()"));
        require(ok);

        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        bytes32 sid = keccak256("paused-session");
        vm.expectRevert();
        _createLightSession(w, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0));

        (bool ok2,) = sm.call(abi.encodeWithSignature("unpause()"));
        require(ok2);
    }

    function invariant_pauseBlocksValidation() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        bytes32 sid = keccak256("validate-paused");
        _createLightSession(w, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0));

        (bool ok,) = sm.call(abi.encodeWithSignature("pause()"));
        require(ok);

        vm.startPrank(w);
        (bool ok2,) = sm.call(abi.encodeWithSignature(
            "validateLightweightSession(bytes32,address,uint256,address)",
            sid, sessionKey1, 0.01 ether, address(0xBEEF)
        ));
        assertFalse(ok2);
        vm.stopPrank();
    }
}
