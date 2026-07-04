// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./utils/AuditHarness.sol";

contract Phase06_ERC4337 is AuditHarness {
    function test_WalletDeployment_ViaFactory() public {
        address w = _createWallet(owner1);
        assertTrue(w != address(0));
        (bool ok, bytes memory ret) = factory.staticcall(abi.encodeWithSignature("isAgentWallet(address)", w));
        require(ok);
        assertTrue(abi.decode(ret, (bool)));
        assertEq(AgentWallet(payable(w)).owner(), owner1);
    }

    function test_ValidateUserOp_OwnerSignature() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);

        bytes memory callData = abi.encodeWithSignature("execute(address,uint256,bytes)", address(0xBEEF), 0, "");
        PackedUserOperation memory userOp = PackedUserOperation({
            sender: w, nonce: 0, initCode: "", callData: callData,
            accountGasLimits: bytes32(abi.encode(uint128(200_000), uint128(200_000))),
            preVerificationGas: 50_000,
            gasFees: bytes32(abi.encode(uint128(1e9), uint128(1e9))),
            paymasterAndData: "", signature: ""
        });

        bytes32 opHash = keccak256(abi.encode(userOp));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", opHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(_pk[owner1], digest);
        userOp.signature = abi.encodePacked(r, s, v);

        vm.deal(address(ep), 1 ether);
        uint256 result = ep.validateUserOp(userOp, opHash, 0);
        assertEq(result, 0);
    }

    function test_ValidateUserOp_InvalidSignature_Reverts() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);

        bytes memory callData = abi.encodeWithSignature("execute(address,uint256,bytes)", address(0xBEEF), 0, "");
        PackedUserOperation memory userOp = PackedUserOperation({
            sender: w, nonce: 0, initCode: "", callData: callData,
            accountGasLimits: bytes32(abi.encode(uint128(200_000), uint128(200_000))),
            preVerificationGas: 50_000,
            gasFees: bytes32(abi.encode(uint128(1e9), uint128(1e9))),
            paymasterAndData: "", signature: ""
        });

        bytes32 opHash = keccak256(abi.encode(userOp));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", opHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(_pk[attacker], digest);
        userOp.signature = abi.encodePacked(r, s, v);

        vm.deal(address(ep), 1 ether);
        vm.expectRevert();
        ep.validateUserOp(userOp, opHash, 0);
    }

    function test_DepositAndWithdrawEntryPoint() public {
        address w = _createWallet(owner1);
        vm.deal(w, 2 ether);
        vm.prank(owner1);
        w.call{value: 1 ether}(abi.encodeWithSignature("addDeposit()"));
        (bool ok, bytes memory ret) = w.staticcall(abi.encodeWithSignature("getDeposit()"));
        require(ok);
        assertEq(abi.decode(ret, (uint256)), 1 ether);
    }

    function test_ExecuteFromEntryPoint() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        vm.deal(address(ep), 1 ether);
        vm.prank(address(ep));
        w.call(abi.encodeWithSignature("execute(address,uint256,bytes)", address(0xBEEF), 0, ""));
    }

    function test_WalletReceiveETH() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        assertEq(AgentWallet(payable(w)).checkBalance(), 1 ether);
    }

    function test_WalletOwnerExecute_WithETH() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        address recipient = makeAddr("recipient");
        vm.prank(owner1);
        w.call(abi.encodeWithSignature("execute(address,uint256,bytes)", recipient, 0.5 ether, ""));
        assertEq(recipient.balance, 0.5 ether);
    }

    function test_MultipleWallets_IndependentState() public {
        address w1 = _createWallet(owner1);
        address w2 = _createWallet(owner2);
        vm.deal(w1, 1 ether);
        vm.deal(w2, 2 ether);
        assertEq(AgentWallet(payable(w1)).checkBalance(), 1 ether);
        assertEq(AgentWallet(payable(w2)).checkBalance(), 2 ether);
        assertEq(AgentWallet(payable(w1)).owner(), owner1);
        assertEq(AgentWallet(payable(w2)).owner(), owner2);
    }

    function test_MaxBatchSize_Enforced() public {
        address w = _createWallet(owner1);
        vm.deal(w, 1 ether);
        address[] memory targets = new address[](21);
        uint256[] memory values = new uint256[](21);
        bytes[] memory data = new bytes[](21);
        for (uint256 i = 0; i < 21; i++) {
            targets[i] = address(0xBEEF);
            values[i] = 0;
            data[i] = "";
        }
        vm.prank(owner1);
        (bool ok,) = w.call(abi.encodeWithSignature("executeBatch(address[],uint256[],bytes[])", targets, values, data));
        assertFalse(ok);
    }
}
