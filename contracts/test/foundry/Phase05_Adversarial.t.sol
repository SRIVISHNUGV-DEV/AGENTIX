// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./utils/AuditHarness.sol";

contract MaliciousReceiver {
    receive() external payable { revert("attack: no ETH"); }
    fallback() external payable { revert("attack: fallback"); }
}

contract GasGriefer {
    uint256 public gasTarget;
    uint256 public dummy;
    function setGas(uint256 _g) external { gasTarget = _g; }
    receive() external payable {
        uint256 target = gasleft() - gasTarget;
        while (gasleft() > target) { dummy++; }
    }
    fallback() external payable {
        uint256 target = gasleft() - gasTarget;
        while (gasleft() > target) { dummy++; }
    }
}

contract ReturnDataBomb {
    uint256 public bombSize;
    function setBombSize(uint256 _s) external { bombSize = _s; }
    function ping() external view returns (bytes memory) {
        return abi.encodePacked(bytes(new bytes(bombSize)));
    }
    receive() external payable {}
}

contract Phase05_Adversarial is AuditHarness {
    function test_MaliciousReceiver_RevertsGracefully() public {
        MaliciousReceiver mr = new MaliciousReceiver();
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        vm.prank(owner1);
        (bool ok,) = w.call(abi.encodeWithSignature("execute(address,uint256,bytes)", address(mr), 0, ""));
        assertFalse(ok);
    }

    function test_GasGriefing_RevertsGracefully() public {
        GasGriefer gg = new GasGriefer();
        gg.setGas(500_000);
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        vm.prank(owner1);
        (bool ok,) = w.call(abi.encodeWithSignature("execute(address,uint256,bytes)", address(gg), 0, ""));
        assertFalse(ok);
    }

    function test_ReturnDataBomb_DoesNotCrash() public {
        ReturnDataBomb bomb = new ReturnDataBomb();
        bomb.setBombSize(1024 * 1024);
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        vm.prank(owner1);
        (bool ok,) = w.call(abi.encodeWithSignature("execute(address,uint256,bytes)",
            address(bomb), 0, abi.encodeWithSignature("ping()")));
        assertTrue(ok);
    }

    function test_ForgedSignature_Reverts() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        bytes32 sid = keccak256("forged");
        bytes32 msgHash = keccak256(abi.encode(
            block.chainid, sm, w, sid, sessionKey1,
            uint256(1 ether), uint256(100), uint64(block.timestamp + 1 hours), new address[](0)
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(_pk[attacker], digest);
        vm.prank(w);
        (bool ok,) = sm.call(abi.encodeWithSignature(
            "createLightweightSession(bytes32,address,uint256,uint256,uint64,address[],bytes)",
            sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), abi.encodePacked(r, s, v)
        ));
        assertFalse(ok);
    }

    function test_NonWallet_CannotValidateSession() public {
        vm.prank(attacker);
        (bool ok,) = sm.call(abi.encodeWithSignature(
            "validateSession(bytes32,address,uint256,address)", keccak256("x"), attacker, 0, address(0xBEEF)
        ));
        assertFalse(ok);
    }

    function test_NonWallet_CannotValidateLightweightSession() public {
        vm.prank(attacker);
        (bool ok,) = sm.call(abi.encodeWithSignature(
            "validateLightweightSession(bytes32,address,uint256,address)", keccak256("x"), attacker, 0, address(0xBEEF)
        ));
        assertFalse(ok);
    }

    function test_RevokedSession_CannotBeUsed() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        bytes32 sid = keccak256("session-revoked");
        _createLightSession(w, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0));
        vm.prank(w);
        (bool ok,) = sm.call(abi.encodeWithSignature("revokeLightweightSession(bytes32,address)", sid, w));
        require(ok);
        vm.startPrank(w);
        (bool ok2,) = sm.call(abi.encodeWithSignature(
            "validateLightweightSession(bytes32,address,uint256,address)", sid, sessionKey1, 0.1 ether, address(0xBEEF)
        ));
        assertFalse(ok2);
        vm.stopPrank();
    }

    function test_ExpiredSession_CannotBeUsed() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        bytes32 sid = keccak256("session-expired");
        _createLightSession(w, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0));
        vm.warp(block.timestamp + 1 hours + 1);
        vm.startPrank(w);
        (bool ok,) = sm.call(abi.encodeWithSignature(
            "validateLightweightSession(bytes32,address,uint256,address)", sid, sessionKey1, 0.1 ether, address(0xBEEF)
        ));
        assertFalse(ok);
        vm.stopPrank();
    }

    function test_NonOwner_CannotExecute() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        vm.prank(attacker);
        (bool ok,) = w.call(abi.encodeWithSignature("execute(address,uint256,bytes)", address(0xBEEF), 0, ""));
        assertFalse(ok);
    }

    function test_ExecuteToZeroAddress_Reverts() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        vm.prank(owner1);
        (bool ok,) = w.call(abi.encodeWithSignature("execute(address,uint256,bytes)", address(0), 0, ""));
        assertFalse(ok);
    }

    function test_Wallet_CannotDoubleInitialize() public {
        address w = _createWallet(owner1);
        vm.prank(owner1);
        (bool ok,) = w.call(abi.encodeWithSignature("initialize(address,address,address)", attacker, sm, address(ep)));
        assertFalse(ok);
    }

    function test_Implementation_CannotBeInitialized() public {
        vm.expectRevert();
        walletImpl.initialize(owner1, sm, address(ep));
    }

    function test_DifferentOwnerSameSalt_Reverts() public {
        bytes32 salt = keccak256("fixed-salt");
        vm.prank(deployer);
        factory.call(abi.encodeWithSignature("createWallet(address,bytes32)", owner1, salt));
        vm.prank(deployer);
        (bool ok,) = factory.call(abi.encodeWithSignature("createWallet(address,bytes32)", attacker, salt));
        assertFalse(ok);
    }

    function test_ExecuteDuringOwnershipTransfer_NewOwnerBlocked() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        vm.prank(owner1);
        w.call(abi.encodeWithSignature("changeOwner(address)", attacker));
        vm.prank(attacker);
        (bool ok,) = w.call(abi.encodeWithSignature("execute(address,uint256,bytes)", address(0xBEEF), 0, ""));
        assertFalse(ok);
    }

    function test_AcceptOwnership_ThenExecute() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        vm.prank(owner1);
        w.call(abi.encodeWithSignature("changeOwner(address)", attacker));
        vm.prank(attacker);
        w.call(abi.encodeWithSignature("acceptOwnership()"));
        vm.prank(attacker);
        (bool ok,) = w.call(abi.encodeWithSignature("execute(address,uint256,bytes)", address(0xBEEF), 0, ""));
        assertTrue(ok);
    }

    function test_SessionManager_WhilePaused_BlocksValidation() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        bytes32 sid = keccak256("paused-validate");
        _createLightSession(w, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0));
        sm.call(abi.encodeWithSignature("pause()"));
        vm.startPrank(w);
        (bool ok,) = sm.call(abi.encodeWithSignature(
            "validateLightweightSession(bytes32,address,uint256,address)", sid, sessionKey1, 0.01 ether, address(0xBEEF)
        ));
        assertFalse(ok);
        vm.stopPrank();
    }

    function test_CredentialRegistry_WhilePaused_BlocksRootUpdate() public {
        credReg.call(abi.encodeWithSignature("pause()"));
        (bool ok,) = credReg.call(abi.encodeWithSignature("updateActiveRoot(bytes32)", keccak256("root")));
        assertFalse(ok);
    }

    function test_TargetRestriction_Enforced() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        bytes32 sid = keccak256("target-restrict");
        address[] memory allowed = new address[](1);
        allowed[0] = address(0xBEEF);
        _createLightSession(w, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), allowed);
        vm.startPrank(w);
        (bool ok1,) = sm.call(abi.encodeWithSignature(
            "validateLightweightSession(bytes32,address,uint256,address)", sid, sessionKey1, 0.01 ether, address(0xCAFE)
        ));
        assertFalse(ok1);
        (bool ok2,) = sm.call(abi.encodeWithSignature(
            "validateLightweightSession(bytes32,address,uint256,address)", sid, sessionKey1, 0.01 ether, address(0xBEEF)
        ));
        assertTrue(ok2);
        vm.stopPrank();
    }

    function test_DailyTxLimit_Enforced() public {
        address w = _createWallet(owner1);
        vm.deal(w, 10 ether);
        bytes32 sid = keccak256("tx-limit");
        _createLightSession(w, sid, sessionKey1, 10 ether, 2, uint64(block.timestamp + 1 hours), new address[](0));
        vm.startPrank(w);
        (bool ok1,) = sm.call(abi.encodeWithSignature(
            "validateLightweightSession(bytes32,address,uint256,address)", sid, sessionKey1, 0.01 ether, address(0xBEEF)
        ));
        assertTrue(ok1);
        (bool ok2,) = sm.call(abi.encodeWithSignature(
            "validateLightweightSession(bytes32,address,uint256,address)", sid, sessionKey1, 0.01 ether, address(0xBEEF)
        ));
        assertTrue(ok2);
        (bool ok3,) = sm.call(abi.encodeWithSignature(
            "validateLightweightSession(bytes32,address,uint256,address)", sid, sessionKey1, 0.01 ether, address(0xBEEF)
        ));
        assertFalse(ok3);
        vm.stopPrank();
    }
}
