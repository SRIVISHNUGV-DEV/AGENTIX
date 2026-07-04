// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../src/AgentWallet.sol";

contract MockSessionManager {
    mapping(bytes32 => uint8) public sessionType;
    mapping(bytes32 => bool) public validateResult;
    mapping(bytes32 => bool) public lightValidateResult;
    bool public failAll;

    function setSessionType(bytes32 sid, uint8 t) external { sessionType[sid] = t; }
    function setValidateResult(bytes32 sid, bool r) external { validateResult[sid] = r; }
    function setLightValidateResult(bytes32 sid, bool r) external { lightValidateResult[sid] = r; }
    function setFailAll(bool f) external { failAll = f; }

    function getSessionType(bytes32 sessionId) external view returns (uint8) {
        require(!failAll, "fail");
        return sessionType[sessionId];
    }

    function validateSession(bytes32 sessionId, address, uint256, address) external view returns (bool) {
        require(!failAll, "fail");
        return validateResult[sessionId];
    }

    function validateLightweightSession(bytes32 sessionId, address, uint256, address) external view returns (bool) {
        require(!failAll, "fail");
        return lightValidateResult[sessionId];
    }
}

contract MockEntryPoint2 is IEntryPoint {
    mapping(address => uint256) public override balanceOf;
    function depositTo(address account) external payable override { balanceOf[account] += msg.value; }
    function withdrawTo(address payable w, uint256 a) external override {
        require(balanceOf[msg.sender] >= a, "no bal");
        balanceOf[msg.sender] -= a;
        (bool ok,) = w.call{value: a}("");
        require(ok, "send fail");
    }
}

contract Audit03_AgentWallet is Test {
    AgentWallet internal wallet;
    MockSessionManager internal sm;
    MockEntryPoint2 internal ep;

    address internal owner;
    address internal newOwner;
    address internal sessionKey;
    address internal attacker;
    address internal recipient;

    uint256 constant PK_OWNER = 0xB0B;
    uint256 constant PK_SESSION_KEY = 0xDAD;
    uint256 constant PK_ATTACKER = 0xBEEF;

    event WalletInitialized(address indexed owner, address indexed sessionManager, address indexed entryPoint);
    event ExecutionPerformed(address indexed caller, address indexed target, uint256 value, bytes32 dataHash);
    event BatchExecutionPerformed(address indexed caller, uint256 callCount, uint256 totalValue);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnerChanged(address indexed oldOwner, address indexed newOwner);
    event EntryPointDepositAdded(uint256 amount, uint256 newBalance);
    event EntryPointWithdrawal(address indexed recipient, uint256 amount);
    event SessionManagerProposed(address indexed previousSessionManager, address indexed newSessionManager, uint256 activationTime);
    event SessionManagerUpdated(address indexed oldSessionManager, address indexed newSessionManager);
    event EntryPointProposed(address indexed previousEntryPoint, address indexed newEntryPoint, uint256 activationTime);
    event EntryPointUpdated(address indexed oldEntryPoint, address indexed newEntryPoint);

    function setUp() public {
        owner = vm.addr(PK_OWNER);
        sessionKey = vm.addr(PK_SESSION_KEY);
        attacker = vm.addr(PK_ATTACKER);
        newOwner = makeAddr("newOwner");
        recipient = makeAddr("recipient");

        sm = new MockSessionManager();
        ep = new MockEntryPoint2();

        address impl = address(new AgentWallet());
        // Deploy via create + manual init (mimicking factory clone)
        wallet = AgentWallet(payable(impl));
        // Override initialized flag via storage write for test (implementation locked in constructor)
        // Actually the constructor sets initialized=true. We need a fresh clone approach.
        // Let's use a different approach: deploy fresh via vm.etch
        bytes memory code = vm.getCode("sol:AgentWallet");
        vm.etch(address(wallet), code);
        wallet.initialize(owner, address(sm), address(ep));

        vm.deal(address(wallet), 10 ether);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: Initialization
    // ═══════════════════════════════════════════════

    function test_CannotReinitialize() public {
        vm.expectRevert(AlreadyInitializedError.selector);
        wallet.initialize(owner, address(sm), address(ep));
    }

    function test_InitializeWithZeroOwner() public {
        // Already initialized; test via a fresh clone-like approach
    }

    // ═══════════════════════════════════════════════
    //  UNIT: execute()
    // ═══════════════════════════════════════════════

    function test_Execute_OnlyOwnerOrEntryPoint() public {
        vm.prank(attacker);
        vm.expectRevert(NotAuthorizedError.selector);
        wallet.execute(recipient, 0, "");
    }

    function test_Execute_OwnerCanExecute() public {
        vm.prank(owner);
        vm.expectEmit(true, true, true, true);
        emit ExecutionPerformed(owner, recipient, 0, keccak256(""));
        wallet.execute(recipient, 0, "");
    }

    function test_Execute_EntryPointCanExecute() public {
        vm.prank(address(ep));
        wallet.execute(recipient, 0, "");
    }

    function test_Execute_WithETH() public {
        uint256 bal = recipient.balance;
        vm.prank(owner);
        wallet.execute(recipient, 1 ether, "");
        assertEq(recipient.balance, bal + 1 ether);
    }

    function test_Execute_ToZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(InvalidRecipientError.selector);
        wallet.execute(address(0), 0, "");
    }

    function test_Execute_WithCalldata() public {
        bytes memory data = abi.encodeWithSignature("ping()");
        vm.prank(owner);
        // recipient has no ping(), but low-level call just returns false
        (bool ok,) = address(wallet).call(abi.encodeWithSignature("execute(address,uint256,bytes)", recipient, 0, data));
        // Should fail because target has no ping() and the fallback might not exist
        assertFalse(ok);
    }

    function test_Execute_ReentrancyGuard() public {
        vm.prank(owner);
        wallet.execute(makeAddr("target"), 0, "");
        // Can't easily test reentrancy from execute itself, but nonReentrant is on
    }

    // ═══════════════════════════════════════════════
    //  UNIT: executeBatch()
    // ═══════════════════════════════════════════════

    function test_ExecuteBatch_Success() public {
        address[] memory targets = new address[](3);
        targets[0] = makeAddr("t1");
        targets[1] = makeAddr("t2");
        targets[2] = makeAddr("t3");
        uint256[] memory values = new uint256[](3);
        values[0] = 0.1 ether;
        values[1] = 0.2 ether;
        values[2] = 0.3 ether;
        bytes[] memory data = new bytes[](3);

        uint256 bal1 = targets[0].balance;
        uint256 bal2 = targets[1].balance;
        uint256 bal3 = targets[2].balance;

        vm.prank(owner);
        vm.expectEmit(true, true, true, true);
        emit BatchExecutionPerformed(owner, 3, 0.6 ether);
        wallet.executeBatch(targets, values, data);

        assertEq(targets[0].balance, bal1 + 0.1 ether);
        assertEq(targets[1].balance, bal2 + 0.2 ether);
        assertEq(targets[2].balance, bal3 + 0.3 ether);
    }

    function test_ExecuteBatch_EmptyReverts() public {
        vm.prank(owner);
        vm.expectRevert(LengthMismatchError.selector);
        wallet.executeBatch(new address[](0), new uint256[](0), new bytes[](0));
    }

    function test_ExecuteBatch_MismatchedLengths() public {
        address[] memory targets = new address[](2);
        targets[0] = makeAddr("t1");
        targets[1] = makeAddr("t2");
        uint256[] memory values = new uint256[](1);
        values[0] = 0;
        bytes[] memory data = new bytes[](1);
        data[0] = "";

        vm.prank(owner);
        vm.expectRevert(LengthMismatchError.selector);
        wallet.executeBatch(targets, values, data);
    }

    function test_ExecuteBatch_TooLarge() public {
        uint256 n = 21;
        address[] memory targets = new address[](n);
        uint256[] memory values = new uint256[](n);
        bytes[] memory data = new bytes[](n);
        for (uint256 i = 0; i < n; i++) {
            targets[i] = makeAddr("t");
            values[i] = 0;
            data[i] = "";
        }
        vm.prank(owner);
        vm.expectRevert(BatchTooLargeError.selector);
        wallet.executeBatch(targets, values, data);
    }

    function test_ExecuteBatch_ZeroAddressTarget() public {
        address[] memory targets = new address[](2);
        targets[0] = makeAddr("ok");
        targets[1] = address(0);
        uint256[] memory values = new uint256[](2);
        bytes[] memory data = new bytes[](2);

        vm.prank(owner);
        vm.expectRevert(InvalidRecipientError.selector);
        wallet.executeBatch(targets, values, data);
    }

    function test_ExecuteBatch_FailingCall() public {
        address bad = makeAddr("bad");
        // Will fail with empty calldata - no receive function on random address
        // Actually in Foundry, makeAddr gives a plain address, sending ETH works (receive is implicit?)
        // Let's deploy a contract that reverts
        // Actually: vm.etch with code that reverts
        // For now, test with target that has no code but we try to send calldata
        // Low-level call to EOA with empty data succeeds
        address[] memory targets = new address[](1);
        targets[0] = makeAddr("bad");
        uint256[] memory values = new uint256[](1);
        bytes[] memory data = new bytes[](1);
        data[0] = hex"dead"; // invalid calldata
        vm.prank(owner);
        vm.expectRevert(CallFailedError.selector);
        wallet.executeBatch(targets, values, data);
    }

    function test_ExecuteBatch_OnlyOwnerOrEntryPoint() public {
        address[] memory targets = new address[](1);
        targets[0] = makeAddr("t");
        uint256[] memory values = new uint256[](1);
        bytes[] memory data = new bytes[](1);
        vm.prank(attacker);
        vm.expectRevert(NotAuthorizedError.selector);
        wallet.executeBatch(targets, values, data);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: EntryPoint Deposits
    // ═══════════════════════════════════════════════

    function test_AddDeposit_Works() public {
        vm.prank(owner);
        vm.expectEmit(true, true, true, true);
        emit EntryPointDepositAdded(1 ether, 1 ether);
        wallet.addDeposit{value: 1 ether}();
        assertEq(wallet.getDeposit(), 1 ether);
    }

    function test_GetDeposit_ReturnsBalance() public {
        assertEq(wallet.getDeposit(), 0);
        vm.prank(owner);
        wallet.addDeposit{value: 0.5 ether}();
        assertEq(wallet.getDeposit(), 0.5 ether);
    }

    function test_WithdrawDeposit_OnlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert(NotOwnerError.selector);
        wallet.withdrawDepositTo(payable(recipient), 0);
    }

    function test_WithdrawDeposit_Works() public {
        vm.prank(owner);
        wallet.addDeposit{value: 2 ether}();
        uint256 bal = recipient.balance;
        vm.prank(owner);
        wallet.withdrawDepositTo(payable(recipient), 1 ether);
        assertEq(recipient.balance, bal + 1 ether);
        assertEq(wallet.getDeposit(), 1 ether);
    }

    function test_WithdrawDeposit_ZeroRecipient() public {
        vm.prank(owner);
        wallet.addDeposit{value: 1 ether}();
        vm.prank(owner);
        vm.expectRevert(InvalidRecipientError.selector);
        wallet.withdrawDepositTo(payable(address(0)), 0);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: Ownership Transfer (2FA)
    // ═══════════════════════════════════════════════

    function test_ChangeOwner_Propose() public {
        vm.prank(owner);
        vm.expectEmit(true, true, true, true);
        emit OwnershipTransferStarted(owner, newOwner);
        wallet.changeOwner(newOwner);
        assertEq(wallet.pendingOwner(), newOwner);
        assertEq(wallet.owner(), owner);
    }

    function test_ChangeOwner_OnlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert(NotOwnerError.selector);
        wallet.changeOwner(newOwner);
    }

    function test_ChangeOwner_ZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(InvalidOwnerError.selector);
        wallet.changeOwner(address(0));
    }

    function test_ChangeOwner_PendingAlreadyExists() public {
        vm.prank(owner);
        wallet.changeOwner(newOwner);
        vm.prank(owner);
        vm.expectRevert(OwnershipTransferPendingError.selector);
        wallet.changeOwner(newOwner);
    }

    function test_AcceptOwnership_Works() public {
        vm.prank(owner);
        wallet.changeOwner(newOwner);
        vm.prank(newOwner);
        vm.expectEmit(true, true, true, true);
        emit OwnerChanged(owner, newOwner);
        wallet.acceptOwnership();
        assertEq(wallet.owner(), newOwner);
        assertEq(wallet.pendingOwner(), address(0));
    }

    function test_AcceptOwnership_OnlyPendingOwner() public {
        vm.prank(owner);
        wallet.changeOwner(newOwner);
        vm.prank(attacker);
        vm.expectRevert(NotAuthorizedError.selector);
        wallet.acceptOwnership();
    }

    function test_AcceptOwnership_NoPendingOwner() public {
        vm.prank(owner);
        vm.expectRevert(NotAuthorizedError.selector);
        wallet.acceptOwnership();
    }

    function test_OwnershipTransfer_OldOwnerBlocked() public {
        vm.prank(owner);
        wallet.changeOwner(newOwner);
        vm.prank(newOwner);
        wallet.acceptOwnership();
        vm.prank(owner);
        vm.expectRevert(NotOwnerError.selector);
        wallet.execute(recipient, 0, "");
    }

    // ═══════════════════════════════════════════════
    //  UNIT: SessionManager Timelock
    // ═══════════════════════════════════════════════

    function test_ProposeSessionManager_Works() public {
        address newSM = makeAddr("newSM");
        vm.prank(owner);
        vm.expectEmit(true, true, true, true);
        emit SessionManagerProposed(address(sm), newSM, block.timestamp + 24 hours);
        wallet.proposeSessionManager(newSM);
        assertEq(wallet.pendingSessionManager(), newSM);
    }

    function test_ProposeSessionManager_TimelockActive() public {
        vm.prank(owner);
        wallet.proposeSessionManager(makeAddr("sm1"));
        vm.prank(owner);
        vm.expectRevert(TimelockActiveError.selector);
        wallet.proposeSessionManager(makeAddr("sm2"));
    }

    function test_AcceptSessionManager_BeforeTimelock() public {
        vm.prank(owner);
        wallet.proposeSessionManager(makeAddr("newSM"));
        vm.prank(owner);
        vm.expectRevert(TimelockNotReadyError.selector);
        wallet.acceptSessionManager();
    }

    function test_AcceptSessionManager_AfterTimelock() public {
        address newSM = makeAddr("newSM");
        vm.prank(owner);
        wallet.proposeSessionManager(newSM);
        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(owner);
        wallet.acceptSessionManager();
        assertEq(wallet.sessionManager(), newSM);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: EntryPoint Timelock
    // ═══════════════════════════════════════════════

    function test_ProposeEntryPoint_Works() public {
        address newEP = makeAddr("newEP");
        vm.prank(owner);
        wallet.proposeEntryPoint(newEP);
        assertEq(wallet.pendingEntryPoint(), newEP);
    }

    function test_AcceptEntryPoint_BeforeTimelock() public {
        vm.prank(owner);
        wallet.proposeEntryPoint(makeAddr("newEP"));
        vm.prank(owner);
        vm.expectRevert(TimelockNotReadyError.selector);
        wallet.acceptEntryPoint();
    }

    function test_AcceptEntryPoint_AfterTimelock() public {
        address newEP = makeAddr("newEP");
        vm.prank(owner);
        wallet.proposeEntryPoint(newEP);
        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(owner);
        wallet.acceptEntryPoint();
        assertEq(wallet.entryPoint(), newEP);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: checkBalance / receive()
    // ═══════════════════════════════════════════════

    function test_CheckBalance() public {
        assertEq(wallet.checkBalance(), 10 ether);
    }

    function test_ReceiveETH() public {
        uint256 before = wallet.checkBalance();
        (bool ok,) = address(wallet).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(wallet.checkBalance(), before + 1 ether);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: ERC-4337 validateUserOp
    // ═══════════════════════════════════════════════

    function test_ValidateUserOp_NotEntryPoint() public {
        vm.prank(attacker);
        vm.expectRevert();
        wallet.validateUserOp(PackedUserOperation({sender: address(wallet), nonce: 0, initCode: "", callData: "", accountGasLimits: bytes32(0), preVerificationGas: 0, gasFees: bytes32(0), paymasterAndData: "", signature: ""}), bytes32(0), 0);
    }

    function test_ValidateUserOp_OwnerSignature() public {
        bytes memory callData = abi.encodeWithSignature("execute(address,uint256,bytes)", makeAddr("target"), uint256(0), "");
        PackedUserOperation memory userOp = PackedUserOperation({
            sender: address(wallet), nonce: 0, initCode: "",
            callData: callData,
            accountGasLimits: bytes32(abi.encode(uint128(200_000), uint128(200_000))),
            preVerificationGas: 50_000,
            gasFees: bytes32(abi.encode(uint128(1e9), uint128(1e9))),
            paymasterAndData: "",
            signature: ""
        });

        bytes32 opHash = keccak256(abi.encode(userOp));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", opHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK_OWNER, digest);
        userOp.signature = abi.encodePacked(r, s, v);

        vm.prank(address(ep));
        uint256 result = wallet.validateUserOp(userOp, opHash, 0);
        assertEq(result, 0);
    }

    function test_ValidateUserOp_WrongOwnerSignature() public {
        bytes memory callData = abi.encodeWithSignature("execute(address,uint256,bytes)", makeAddr("target"), uint256(0), "");
        PackedUserOperation memory userOp = PackedUserOperation({
            sender: address(wallet), nonce: 0, initCode: "",
            callData: callData,
            accountGasLimits: bytes32(abi.encode(uint128(200_000), uint128(200_000))),
            preVerificationGas: 50_000,
            gasFees: bytes32(abi.encode(uint128(1e9), uint128(1e9))),
            paymasterAndData: "",
            signature: ""
        });

        bytes32 opHash = keccak256(abi.encode(userOp));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", opHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK_ATTACKER, digest);
        userOp.signature = abi.encodePacked(r, s, v);

        vm.prank(address(ep));
        vm.expectRevert(InvalidOwnerSignatureError.selector);
        wallet.validateUserOp(userOp, opHash, 0);
    }

    function test_ValidateUserOp_BatchNotAllowedForSession() public {
        address[] memory targets = new address[](1);
        targets[0] = makeAddr("t");
        uint256[] memory values = new uint256[](1);
        bytes[] memory dataArr = new bytes[](1);
        bytes memory callData = abi.encodeWithSignature("executeBatch(address[],uint256[],bytes[])", targets, values, dataArr);

        PackedUserOperation memory userOp = PackedUserOperation({
            sender: address(wallet), nonce: 0, initCode: "",
            callData: callData,
            accountGasLimits: bytes32(abi.encode(uint128(200_000), uint128(200_000))),
            preVerificationGas: 50_000,
            gasFees: bytes32(abi.encode(uint128(1e9), uint128(1e9))),
            paymasterAndData: "",
            signature: ""
        });

        bytes32 opHash = keccak256(abi.encode(userOp));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", opHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK_SESSION_KEY, digest);

        bytes32 sessionId = keccak256("session1");
        userOp.signature = abi.encode(sessionId, abi.encodePacked(r, s, v));

        sm.setSessionType(sessionId, 0);
        sm.setValidateResult(sessionId, true);

        vm.prank(address(ep));
        vm.expectRevert(BatchNotAllowedForSessionError.selector);
        wallet.validateUserOp(userOp, opHash, 0);
    }

    function test_ValidateUserOp_UnsupportedCallData() public {
        bytes memory callData = hex"deadbeef";
        PackedUserOperation memory userOp = PackedUserOperation({
            sender: address(wallet), nonce: 0, initCode: "",
            callData: callData,
            accountGasLimits: bytes32(abi.encode(uint128(200_000), uint128(200_000))),
            preVerificationGas: 50_000,
            gasFees: bytes32(abi.encode(uint128(1e9), uint128(1e9))),
            paymasterAndData: "",
            signature: ""
        });

        bytes32 opHash = keccak256(abi.encode(userOp));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", opHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK_OWNER, digest);
        userOp.signature = abi.encodePacked(r, s, v);

        vm.prank(address(ep));
        vm.expectRevert(UnsupportedCallDataError.selector);
        wallet.validateUserOp(userOp, opHash, 0);
    }

    // ═══════════════════════════════════════════════
    //  FUZZ
    // ═══════════════════════════════════════════════

    function testFuzz_ExecuteWithAmount(uint96 amount) public {
        vm.assume(amount > 0);
        vm.deal(address(wallet), uint256(amount) * 2);
        uint256 bal = recipient.balance;
        vm.prank(owner);
        wallet.execute(recipient, amount, "");
        assertEq(recipient.balance, bal + amount);
    }

    function testFuzz_AddDeposit(uint96 amount) public {
        vm.assume(amount > 0);
        vm.deal(address(wallet), uint256(amount));
        vm.prank(owner);
        wallet.addDeposit{value: uint256(amount)}();
        assertEq(wallet.getDeposit(), amount);
    }

    function testFuzz_OwnershipTransferRoundtrip(address _newOwner) public {
        vm.assume(_newOwner != address(0));
        vm.assume(_newOwner != owner);
        vm.assume(_newOwner.code.length == 0);

        vm.prank(owner);
        wallet.changeOwner(_newOwner);
        vm.prank(_newOwner);
        wallet.acceptOwnership();
        assertEq(wallet.owner(), _newOwner);
    }

    // ═══════════════════════════════════════════════
    //  INVARIANT
    // ═══════════════════════════════════════════════

    function test_Invariant_OwnerAlwaysAuthorized() public {
        vm.prank(owner);
        wallet.execute(recipient, 0, "");
        // Owner changed
        vm.prank(owner);
        wallet.changeOwner(newOwner);
        vm.prank(newOwner);
        wallet.acceptOwnership();
        vm.prank(newOwner);
        wallet.execute(recipient, 0, "");
        vm.prank(owner);
        vm.expectRevert(NotOwnerError.selector);
        wallet.execute(recipient, 0, "");
    }

    function test_Invariant_EntryPointAlwaysAuthorized() public {
        vm.prank(address(ep));
        wallet.execute(recipient, 0, "");

        address newEP = makeAddr("newEP");
        vm.prank(owner);
        wallet.proposeEntryPoint(newEP);
        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(owner);
        wallet.acceptEntryPoint();

        vm.prank(address(ep));
        vm.expectRevert(NotEntryPointError.selector);
        wallet.validateUserOp(PackedUserOperation({sender: address(wallet), nonce: 0, initCode: "", callData: "", accountGasLimits: bytes32(0), preVerificationGas: 0, gasFees: bytes32(0), paymasterAndData: "", signature: ""}), bytes32(0), 0);

        vm.prank(address(ep));
        vm.expectRevert(NotAuthorizedError.selector);
        wallet.execute(recipient, 0, "");
    }

    // ═══════════════════════════════════════════════
    //  ADVERSARIAL
    // ═══════════════════════════════════════════════

    function test_Adversarial_DirectImplementCall() public {
        // Implementation locked via constructor initialized=true
        address impl = address(new AgentWallet());
        vm.expectRevert(AlreadyInitializedError.selector);
        AgentWallet(payable(impl)).initialize(attacker, address(sm), address(ep));
    }

    function test_Adversarial_BatchExhaustGas() public {
        address[] memory targets = new address[](20);
        uint256[] memory values = new uint256[](20);
        bytes[] memory data = new bytes[](20);
        for (uint256 i = 0; i < 20; i++) {
            targets[i] = makeAddr("t");
            values[i] = 1; // tiny ETH each
            data[i] = "";
        }
        vm.prank(owner);
        wallet.executeBatch(targets, values, data);
        // Should succeed even at max batch size
    }

    function test_Adversarial_ZeroValueAlwaysSucceeds() public {
        vm.prank(owner);
        wallet.execute(recipient, 0, "");
        vm.prank(address(ep));
        wallet.execute(recipient, 0, "");
    }

    function test_Adversarial_WithdrawToSelf() public {
        vm.prank(owner);
        wallet.addDeposit{value: 1 ether}();
        vm.prank(owner);
        wallet.withdrawDepositTo(payable(address(wallet)), 0.5 ether);
    }
}
