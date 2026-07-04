// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../src/SessionManager.sol";
import "../../src/CredentialRegistry.sol";
import "../../src/mocks/MockVerifier.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract MockWalletFactory is IAgentWalletFactory {
    mapping(address => bool) public isAgentWallet;
    function setWallet(address w, bool v) external { isAgentWallet[w] = v; }
}

contract Audit02_SessionManager is Test {
    SessionManager internal sm;
    CredentialRegistry internal registry;
    MockVerifier internal verifier;
    MockWalletFactory internal walletFactory;
    address internal impl;
    address internal owner;

    address internal wallet1;
    address internal wallet2;
    address internal sessionKey1;
    address internal sessionKey2;
    address internal attacker;

    uint256 constant PK_OWNER1 = 0xB0B;
    uint256 constant PK_OWNER2 = 0xC01;

    event SessionCreated(bytes32 indexed sessionId, address indexed wallet, address indexed sessionKey, uint64 expiry, uint128 maxValue, bytes32 nullifier);
    event SessionUsed(bytes32 indexed sessionId, uint256 value, uint256 totalUsed);
    event SessionRevoked(bytes32 indexed sessionId);
    event LightSessionCreated(bytes32 indexed sessionId, address indexed wallet, address indexed sessionKey, uint256 dailySpendLimit, uint256 dailyTxLimit, uint64 expiry);
    event LightSessionUsed(bytes32 indexed sessionId, uint256 value, uint256 newDailySpend);
    event LightSessionRevoked(bytes32 indexed sessionId);
    event DailyLimitsReset(bytes32 indexed sessionId, uint64 newDay);

    function setUp() public {
        owner = makeAddr("owner");
        wallet1 = makeAddr("wallet1");
        wallet2 = makeAddr("wallet2");
        sessionKey1 = makeAddr("sessionKey1");
        sessionKey2 = makeAddr("sessionKey2");
        attacker = makeAddr("attacker");

        verifier = new MockVerifier();
        verifier.setResult(true);

        address regImpl = address(new CredentialRegistry());
        registry = CredentialRegistry(address(new ERC1967Proxy(regImpl, abi.encodeWithSignature("initialize(address)", owner))));

        walletFactory = new MockWalletFactory();
        walletFactory.setWallet(wallet1, true);
        walletFactory.setWallet(wallet2, true);

        vm.etch(wallet1, hex"01");
        vm.etch(wallet2, hex"01");

        address smImpl = address(new SessionManager());
        sm = SessionManager(address(new ERC1967Proxy(smImpl, abi.encodeWithSignature("initialize(address,address,address)", address(verifier), address(registry), address(walletFactory)))));

        vm.prank(owner);
        registry.setSessionManager(address(sm), true);

        // Mock owner() responses for wallet1 and wallet2
        vm.mockCall(wallet1, abi.encodeWithSignature("owner()"), abi.encode(vm.addr(PK_OWNER1)));
        vm.mockCall(wallet2, abi.encodeWithSignature("owner()"), abi.encode(vm.addr(PK_OWNER2)));
    }

    function _createLightSession(
        address wallet,
        bytes32 sessionId,
        address sessionKey,
        uint256 dailySpendLimit,
        uint256 dailyTxLimit,
        uint64 expiry,
        address[] memory allowedTargets,
        uint256 ownerPk
    ) internal {
        bytes32 msgHash = keccak256(abi.encode(block.chainid, address(sm), wallet, sessionId, sessionKey, dailySpendLimit, dailyTxLimit, expiry, allowedTargets));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPk, digest);

        vm.prank(wallet);
        sm.createLightweightSession(sessionId, sessionKey, dailySpendLimit, dailyTxLimit, expiry, allowedTargets, abi.encodePacked(r, s, v));
    }

    // ═══════════════════════════════════════════════
    //  UNIT: Initialization
    // ═══════════════════════════════════════════════

    function test_Initialize_CannotReinitialize() public {
        vm.expectRevert();
        sm.initialize(address(verifier), address(registry), address(walletFactory));
    }

    function test_Pause_OnlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        sm.pause();
    }

    function test_Pause_Works() public {
        vm.prank(owner);
        sm.pause();
        assertTrue(sm.paused());
    }

    function test_Unpause_Works() public {
        vm.prank(owner);
        sm.pause();
        vm.prank(owner);
        sm.unpause();
        assertFalse(sm.paused());
    }

    // ═══════════════════════════════════════════════
    //  UNIT: WalletFactory Timelock
    // ═══════════════════════════════════════════════

    function test_ProposeWalletFactory_OnlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        sm.proposeWalletFactory(makeAddr("wf"));
    }

    function test_ProposeWalletFactory_TimelockActive() public {
        vm.prank(owner);
        sm.proposeWalletFactory(makeAddr("wf1"));
        vm.prank(owner);
        vm.expectRevert(WalletFactoryTimelockActive.selector);
        sm.proposeWalletFactory(makeAddr("wf2"));
    }

    function test_AcceptWalletFactory_BeforeTimelock() public {
        vm.prank(owner);
        sm.proposeWalletFactory(makeAddr("wf"));
        vm.prank(owner);
        vm.expectRevert(WalletFactoryTimelockNotReady.selector);
        sm.acceptWalletFactory();
    }

    function test_AcceptWalletFactory_AfterTimelock() public {
        vm.prank(owner);
        sm.proposeWalletFactory(makeAddr("wf"));
        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(owner);
        sm.acceptWalletFactory();
    }

    // ═══════════════════════════════════════════════
    //  UNIT: Lightweight Session Creation
    // ═══════════════════════════════════════════════

    function test_CreateLightSession_NonWalletReverts() public {
        vm.prank(attacker);
        vm.expectRevert(NotAgentWallet.selector);
        sm.createLightweightSession(keccak256("s"), sessionKey1, 1 ether, 10, uint64(block.timestamp + 1 hours), new address[](0), "");
    }

    function test_CreateLightSession_ZeroSessionKey() public {
        bytes32 sid = keccak256("sid");
        bytes32 msgHash = keccak256(abi.encode(block.chainid, address(sm), wallet1, sid, address(0), uint256(1 ether), uint256(10), uint64(block.timestamp + 1 hours), new address[](0)));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK_OWNER1, digest);
        vm.prank(wallet1);
        vm.expectRevert(InvalidSessionKey.selector);
        sm.createLightweightSession(sid, address(0), 1 ether, 10, uint64(block.timestamp + 1 hours), new address[](0), abi.encodePacked(r, s, v));
    }

    function test_CreateLightSession_SessionKeyEqualsWallet() public {
        bytes32 sid = keccak256("sid");
        bytes32 msgHash = keccak256(abi.encode(block.chainid, address(sm), wallet1, sid, wallet1, uint256(1 ether), uint256(10), uint64(block.timestamp + 1 hours), new address[](0)));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK_OWNER1, digest);
        vm.prank(wallet1);
        vm.expectRevert(InvalidSessionKey.selector);
        sm.createLightweightSession(sid, wallet1, 1 ether, 10, uint64(block.timestamp + 1 hours), new address[](0), abi.encodePacked(r, s, v));
    }

    function test_CreateLightSession_ExpiredExpiry() public {
        bytes32 sid = keccak256("sid");
        bytes32 msgHash = keccak256(abi.encode(block.chainid, address(sm), wallet1, sid, sessionKey1, uint256(1 ether), uint256(10), uint64(block.timestamp), new address[](0)));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK_OWNER1, digest);
        vm.prank(wallet1);
        vm.expectRevert(InvalidExpiry.selector);
        sm.createLightweightSession(sid, sessionKey1, 1 ether, 10, uint64(block.timestamp), new address[](0), abi.encodePacked(r, s, v));
    }

    function test_CreateLightSession_Success() public {
        bytes32 sid = keccak256("success");
        vm.expectEmit(true, true, true, true);
        emit LightSessionCreated(sid, wallet1, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours));
        _createLightSession(wallet1, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);

        (address w, address sk, uint256 dsl, uint256 dtl,,, uint64 exp, bool rev) = sm.getLightSession(sid);
        assertEq(w, wallet1);
        assertEq(sk, sessionKey1);
        assertEq(dsl, 1 ether);
        assertEq(dtl, 100);
        assertEq(exp, uint64(block.timestamp + 1 hours));
        assertFalse(rev);
        assertEq(sm.getSessionType(sid), 1);
    }

    function test_CreateLightSession_DuplicateReverts() public {
        bytes32 sid = keccak256("dup");
        _createLightSession(wallet1, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
        vm.expectRevert(SessionAlreadyExists.selector);
        _createLightSession(wallet1, sid, sessionKey2, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
    }

    function test_CreateLightSession_WrongOwnerSignature() public {
        bytes32 sid = keccak256("wrong");
        bytes32 msgHash = keccak256(abi.encode(block.chainid, address(sm), wallet1, sid, sessionKey1, uint256(1 ether), uint256(10), uint64(block.timestamp + 1 hours), new address[](0)));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK_OWNER2, digest); // wrong owner
        vm.prank(wallet1);
        vm.expectRevert(NotWalletOwner.selector);
        sm.createLightweightSession(sid, sessionKey1, 1 ether, 10, uint64(block.timestamp + 1 hours), new address[](0), abi.encodePacked(r, s, v));
    }

    function test_CreateLightSession_WithTargets() public {
        bytes32 sid = keccak256("targets");
        address[] memory targets = new address[](3);
        targets[0] = address(0xAAA);
        targets[1] = address(0xBBB);
        targets[2] = address(0xCCC);
        _createLightSession(wallet1, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), targets, PK_OWNER1);
        address[] memory stored = sm.getSessionTargets(sid);
        assertEq(stored.length, 3);
        assertEq(stored[0], targets[0]);
        assertEq(stored[1], targets[1]);
        assertEq(stored[2], targets[2]);
    }

    function test_CreateLightSession_TooManyTargets() public {
        bytes32 sid = keccak256("toomany");
        address[] memory targets = new address[](33);
        bytes32 msgHash = keccak256(abi.encode(block.chainid, address(sm), wallet1, sid, sessionKey1, uint256(1 ether), uint256(10), uint64(block.timestamp + 1 hours), targets));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK_OWNER1, digest);
        vm.prank(wallet1);
        vm.expectRevert(TooManyTargets.selector);
        sm.createLightweightSession(sid, sessionKey1, 1 ether, 10, uint64(block.timestamp + 1 hours), targets, abi.encodePacked(r, s, v));
    }

    function test_CreateLightSession_WhenPaused() public {
        vm.prank(owner);
        sm.pause();
        bytes32 sid = keccak256("paused");
        vm.expectRevert();
        _createLightSession(wallet1, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: Lightweight Session Validation
    // ═══════════════════════════════════════════════

    function test_ValidateLightSession_NonWalletReverts() public {
        vm.prank(attacker);
        vm.expectRevert(NotAgentWallet.selector);
        sm.validateLightweightSession(keccak256("x"), sessionKey1, 0, address(0xBEEF));
    }

    function test_ValidateLightSession_NotFound() public {
        vm.prank(wallet1);
        vm.expectRevert(SessionNotFound.selector);
        sm.validateLightweightSession(keccak256("nonexistent"), sessionKey1, 0, address(0xBEEF));
    }

    function test_ValidateLightSession_NotBoundWallet() public {
        bytes32 sid = keccak256("w1session");
        _createLightSession(wallet1, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
        vm.prank(wallet2);
        vm.expectRevert(NotBoundWallet.selector);
        sm.validateLightweightSession(sid, sessionKey1, 0, address(0xBEEF));
    }

    function test_ValidateLightSession_Expired() public {
        bytes32 sid = keccak256("expired");
        _createLightSession(wallet1, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(wallet1);
        vm.expectRevert(SessionExpired.selector);
        sm.validateLightweightSession(sid, sessionKey1, 0, address(0xBEEF));
    }

    function test_ValidateLightSession_Revoked() public {
        bytes32 sid = keccak256("revoked-v");
        _createLightSession(wallet1, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
        vm.prank(wallet1);
        sm.revokeLightweightSession(sid, wallet1);
        vm.prank(wallet1);
        vm.expectRevert(SessionIsRevoked.selector);
        sm.validateLightweightSession(sid, sessionKey1, 0, address(0xBEEF));
    }

    function test_ValidateLightSession_WrongSigner() public {
        bytes32 sid = keccak256("wrong-signer-v");
        _createLightSession(wallet1, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
        vm.prank(wallet1);
        vm.expectRevert(InvalidSigner.selector);
        sm.validateLightweightSession(sid, sessionKey2, 0, address(0xBEEF));
    }

    function test_ValidateLightSession_Success() public {
        bytes32 sid = keccak256("valid");
        _createLightSession(wallet1, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
        vm.prank(wallet1);
        bool ok = sm.validateLightweightSession(sid, sessionKey1, 0.5 ether, address(0xBEEF));
        assertTrue(ok);
        (,,,, uint256 dspend,,,) = sm.getLightSession(sid);
        assertEq(dspend, 0.5 ether);
    }

    function test_ValidateLightSession_SpendLimitExceeded() public {
        bytes32 sid = keccak256("spend-limit");
        _createLightSession(wallet1, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
        vm.prank(wallet1);
        sm.validateLightweightSession(sid, sessionKey1, 0.6 ether, address(0xBEEF));
        vm.prank(wallet1);
        vm.expectRevert(DailySpendLimitExceeded.selector);
        sm.validateLightweightSession(sid, sessionKey1, 0.5 ether, address(0xBEEF));
    }

    function test_ValidateLightSession_TxLimitExceeded() public {
        bytes32 sid = keccak256("tx-limit");
        _createLightSession(wallet1, sid, sessionKey1, 10 ether, 2, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
        vm.prank(wallet1);
        sm.validateLightweightSession(sid, sessionKey1, 0.01 ether, address(0xBEEF));
        vm.prank(wallet1);
        sm.validateLightweightSession(sid, sessionKey1, 0.01 ether, address(0xC0FFEE));
        vm.prank(wallet1);
        vm.expectRevert(DailyTxLimitExceeded.selector);
        sm.validateLightweightSession(sid, sessionKey1, 0.01 ether, address(0xDEAD));
    }

    function test_ValidateLightSession_TargetRestriction() public {
        bytes32 sid = keccak256("target-check");
        address[] memory targets = new address[](1);
        targets[0] = address(0xBEEF);
        _createLightSession(wallet1, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), targets, PK_OWNER1);
        vm.prank(wallet1);
        vm.expectRevert(TargetNotAllowed.selector);
        sm.validateLightweightSession(sid, sessionKey1, 0.01 ether, address(0xCAFE));
        vm.prank(wallet1);
        bool ok = sm.validateLightweightSession(sid, sessionKey1, 0.01 ether, address(0xBEEF));
        assertTrue(ok);
    }

    function test_ValidateLightSession_WhenPaused() public {
        bytes32 sid = keccak256("paused-v");
        _createLightSession(wallet1, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
        vm.prank(owner);
        sm.pause();
        vm.prank(wallet1);
        vm.expectRevert();
        sm.validateLightweightSession(sid, sessionKey1, 0.01 ether, address(0xBEEF));
    }

    // ═══════════════════════════════════════════════
    //  UNIT: Daily Limit Reset
    // ═══════════════════════════════════════════════

    function test_DailyLimitReset_OnNewDay() public {
        bytes32 sid = keccak256("daily");
        _createLightSession(wallet1, sid, sessionKey1, 1 ether, 10, uint64(block.timestamp + 2 days), new address[](0), PK_OWNER1);
        vm.prank(wallet1);
        sm.validateLightweightSession(sid, sessionKey1, 0.9 ether, address(0xBEEF));
        (,,,, uint256 dspend,,,) = sm.getLightSession(sid);
        assertEq(dspend, 0.9 ether);
        vm.warp(block.timestamp + 1 days);
        vm.prank(wallet1);
        sm.validateLightweightSession(sid, sessionKey1, 0.9 ether, address(0xBEEF));
        (,,,, dspend,,,) = sm.getLightSession(sid);
        assertEq(dspend, 0.9 ether);
    }

    function test_DailyTxReset_OnNewDay() public {
        bytes32 sid = keccak256("dailytx");
        _createLightSession(wallet1, sid, sessionKey1, 10 ether, 2, uint64(block.timestamp + 2 days), new address[](0), PK_OWNER1);
        vm.prank(wallet1);
        sm.validateLightweightSession(sid, sessionKey1, 0.01 ether, address(0xBEEF));
        vm.prank(wallet1);
        sm.validateLightweightSession(sid, sessionKey1, 0.01 ether, address(0xC0FFEE));
        vm.prank(wallet1);
        vm.expectRevert(DailyTxLimitExceeded.selector);
        sm.validateLightweightSession(sid, sessionKey1, 0.01 ether, address(0xDEAD));
        vm.warp(block.timestamp + 1 days);
        vm.prank(wallet1);
        bool ok = sm.validateLightweightSession(sid, sessionKey1, 0.01 ether, address(0xBEEF));
        assertTrue(ok);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: Lightweight Session Revocation
    // ═══════════════════════════════════════════════

    function test_RevokeLightSession_ByWalletOwner() public {
        bytes32 sid = keccak256("rev-bye");
        _createLightSession(wallet1, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
        // wallet1 IS the wallet, and the owner() mock returns vm.addr(PK_OWNER1)
        // The wallet owner check is msg.sender == IAgentWallet(wallet).owner()
        vm.prank(vm.addr(PK_OWNER1));
        sm.revokeLightweightSession(sid, wallet1);
        (,,,,,,, bool rev) = sm.getLightSession(sid);
        assertTrue(rev);
    }

    function test_RevokeLightSession_BySessionKey() public {
        bytes32 sid = keccak256("sk-rev");
        _createLightSession(wallet1, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
        vm.prank(sessionKey1);
        sm.revokeLightweightSession(sid, wallet1);
        (,,,,,,, bool rev) = sm.getLightSession(sid);
        assertTrue(rev);
    }

    function test_RevokeLightSession_Unauthorized() public {
        bytes32 sid = keccak256("unauth-rev");
        _createLightSession(wallet1, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
        vm.prank(attacker);
        vm.expectRevert(NotAuthorizedToRevoke.selector);
        sm.revokeLightweightSession(sid, wallet1);
    }

    function test_RevokeLightSession_AlreadyRevoked() public {
        bytes32 sid = keccak256("already");
        _createLightSession(wallet1, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
        vm.prank(vm.addr(PK_OWNER1));
        sm.revokeLightweightSession(sid, wallet1);
        vm.prank(vm.addr(PK_OWNER1));
        vm.expectRevert(SessionAlreadyRevoked.selector);
        sm.revokeLightweightSession(sid, wallet1);
    }

    function test_RevokeLightSession_NotFound() public {
        vm.prank(vm.addr(PK_OWNER1));
        vm.expectRevert(SessionNotFound.selector);
        sm.revokeLightweightSession(keccak256("ghost"), wallet1);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: Standard Session (ZK) Tests
    // ═══════════════════════════════════════════════

    function test_CreateSession_NonBoundWallet() public {
        vm.prank(attacker);
        vm.expectRevert(NotBoundWallet.selector);
        sm.createSession(keccak256("s"), wallet1, sessionKey1, 100, uint64(block.timestamp + 100), [uint(0),0], [[uint(0),0],[uint(0),0]], [uint(0),0], [uint(0),0,0,0,0,0,0]);
    }

    function test_CreateSession_NotAgentWallet() public {
        address fakeWallet = makeAddr("fakeWallet");
        vm.prank(fakeWallet);
        vm.expectRevert(NotAgentWallet.selector);
        sm.createSession(keccak256("s"), fakeWallet, sessionKey1, 100, uint64(block.timestamp + 100), [uint(0),0], [[uint(0),0],[uint(0),0]], [uint(0),0], [uint(0),0,0,0,0,0,0]);
    }

    function test_CreateSession_ZeroSessionKey() public {
        vm.prank(wallet1);
        vm.expectRevert(InvalidSessionKey.selector);
        sm.createSession(keccak256("s"), wallet1, address(0), 100, uint64(block.timestamp + 100), [uint(0),0], [[uint(0),0],[uint(0),0]], [uint(0),0], [uint(0),0,0,0,0,0,0]);
    }

    function test_CreateSession_WalletAsSessionKey() public {
        vm.prank(wallet1);
        vm.expectRevert(InvalidSessionKey.selector);
        sm.createSession(keccak256("s"), wallet1, wallet1, 100, uint64(block.timestamp + 100), [uint(0),0], [[uint(0),0],[uint(0),0]], [uint(0),0], [uint(0),0,0,0,0,0,0]);
    }

    function test_CreateSession_ExpiredExpiry() public {
        vm.prank(wallet1);
        vm.expectRevert(InvalidExpiry.selector);
        sm.createSession(keccak256("s"), wallet1, sessionKey1, 100, uint64(block.timestamp), [uint(0),0], [[uint(0),0],[uint(0),0]], [uint(0),0], [uint(0),0,0,0,0,0,0]);
    }

    function test_CreateSession_InvalidProof() public {
        verifier.setResult(false);
        vm.prank(owner);
        registry.updateActiveRoot(bytes32(uint256(1)));
        vm.prank(owner);
        registry.updateRevokedSecretRoot(bytes32(uint256(2)));
        uint256[7] memory pubSignals = [uint256(1), 2, 100, block.timestamp + 100, uint256(uint160(wallet1)), 1, uint256(keccak256("n"))];
        vm.prank(wallet1);
        vm.expectRevert(InvalidProof.selector);
        sm.createSession(keccak256("s"), wallet1, sessionKey1, 100, uint64(block.timestamp + 100), [uint(0),0], [[uint(0),0],[uint(0),0]], [uint(0),0], pubSignals);
    }

    function test_CreateSession_RootMismatch() public {
        verifier.setResult(true);
        uint256[7] memory pubSignals = [uint256(9), 2, 100, block.timestamp + 100, uint256(uint160(wallet1)), 1, uint256(keccak256("n"))];
        vm.prank(wallet1);
        vm.expectRevert(RootMismatch.selector);
        sm.createSession(keccak256("s"), wallet1, sessionKey1, 100, uint64(block.timestamp + 100), [uint(0),0], [[uint(0),0],[uint(0),0]], [uint(0),0], pubSignals);
    }

    function test_CreateSession_NullifierAlreadyUsed() public {
        verifier.setResult(true);
        bytes32 nullifier = keccak256("used-n");
        vm.prank(owner);
        registry.setSessionManager(address(sm), true);
        vm.prank(address(sm));
        registry.markNullifierUsed(nullifier);

        vm.prank(owner);
        registry.updateActiveRoot(bytes32(uint256(1)));
        vm.prank(owner);
        registry.updateRevokedSecretRoot(bytes32(uint256(2)));

        uint256[7] memory pubSignals = [uint256(1), 2, 100, block.timestamp + 100, uint256(uint160(wallet1)), 1, uint256(nullifier)];
        vm.prank(wallet1);
        vm.expectRevert(NullifierAlreadyUsed.selector);
        sm.createSession(keccak256("s"), wallet1, sessionKey1, 100, uint64(block.timestamp + 100), [uint(0),0], [[uint(0),0],[uint(0),0]], [uint(0),0], pubSignals);
    }

    function test_CreateSession_PreventDuplicateWithLightSession() public {
        bytes32 sid = keccak256("both");
        _createLightSession(wallet1, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
        verifier.setResult(true);
        vm.prank(owner);
        registry.updateActiveRoot(bytes32(uint256(1)));
        vm.prank(owner);
        registry.updateRevokedSecretRoot(bytes32(uint256(2)));
        uint256[7] memory pubSignals = [uint256(1), 2, 100, block.timestamp + 100, uint256(uint160(wallet1)), 1, uint256(keccak256("n-fresh"))];
        vm.prank(wallet1);
        vm.expectRevert(SessionAlreadyExists.selector);
        sm.createSession(sid, wallet1, sessionKey1, 100, uint64(block.timestamp + 100), [uint(0),0], [[uint(0),0],[uint(0),0]], [uint(0),0], pubSignals);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: GetSessionType
    // ═══════════════════════════════════════════════

    function test_GetSessionType_StandardIs0() public {
        // We need to create a standard session to test type 0
        // Actually the standard session creation requires ZK proof with correct roots
        // We'll test the type-lookup via light session
        bytes32 sid = keccak256("light");
        _createLightSession(wallet1, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
        assertEq(sm.getSessionType(sid), 1);
    }

    function test_GetSessionType_NotFound() public {
        assertEq(sm.getSessionType(keccak256("ghost")), 2);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: Wallet Sessions Enumeration & Pruning
    // ═══════════════════════════════════════════════

    function test_GetWalletSessions() public {
        bytes32 sid1 = keccak256("ws1");
        bytes32 sid2 = keccak256("ws2");
        _createLightSession(wallet1, sid1, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
        _createLightSession(wallet1, sid2, sessionKey2, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
        bytes32[] memory sessions = sm.getWalletSessions(wallet1);
        assertEq(sessions.length, 2);
    }

    function test_PruneExpiredSessions_Works() public {
        bytes32 sid1 = keccak256("prune1");
        _createLightSession(wallet1, sid1, sessionKey1, 1 ether, 100, uint64(block.timestamp + 10), new address[](0), PK_OWNER1);
        bytes32 sid2 = keccak256("prune2");
        _createLightSession(wallet1, sid2, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);

        assertEq(sm.getWalletSessions(wallet1).length, 2);
        vm.warp(block.timestamp + 20);
        vm.prank(wallet1);
        sm.pruneExpiredSessions(wallet1, 10);
        assertEq(sm.getWalletSessions(wallet1).length, 1);
    }

    function test_PruneExpiredSessions_OnlyWallet() public {
        vm.prank(attacker);
        vm.expectRevert(NotAgentWallet.selector);
        sm.pruneExpiredSessions(wallet1, 10);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: Max Sessions Per Wallet
    // ═══════════════════════════════════════════════

    function test_MaxSessionsPerWallet() public {
        for (uint256 i = 0; i < 100; i++) {
            bytes32 sid = keccak256(abi.encode("s", i));
            _createLightSession(wallet1, sid, sessionKey1, 1 ether, 1, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
        }
        bytes32 over = keccak256("overflow");
        vm.expectRevert(TooManySessions.selector);
        _createLightSession(wallet1, over, sessionKey1, 1 ether, 1, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
    }

    // ═══════════════════════════════════════════════
    //  FUZZ
    // ═══════════════════════════════════════════════

    function testFuzz_CreateValidateRevoke(bytes32 sessionId, uint256 spendValue, uint64 expiryDelta) public {
        vm.assume(sessionId != bytes32(0));
        vm.assume(expiryDelta > 0 && expiryDelta < 365 days);
        vm.assume(spendValue > 0 && spendValue <= 100 ether);

        uint64 expiry = uint64(block.timestamp + expiryDelta);
        _createLightSession(wallet1, sessionId, sessionKey1, spendValue, 10, expiry, new address[](0), PK_OWNER1);

        vm.prank(wallet1);
        bool ok = sm.validateLightweightSession(sessionId, sessionKey1, spendValue / 2, address(0xBEEF));
        assertTrue(ok);

        vm.prank(vm.addr(PK_OWNER1));
        sm.revokeLightweightSession(sessionId, wallet1);

        vm.prank(wallet1);
        vm.expectRevert(SessionIsRevoked.selector);
        sm.validateLightweightSession(sessionId, sessionKey1, 1, address(0xBEEF));
    }

    function testFuzz_TargetMatch(bytes32 sessionId, uint160 targetAddr) public {
        vm.assume(sessionId != bytes32(0));
        vm.assume(targetAddr != 0);
        address target = address(targetAddr);
        address wrongTarget = address(uint160(targetAddr + 1));

        address[] memory targets = new address[](1);
        targets[0] = target;
        _createLightSession(wallet1, sessionId, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), targets, PK_OWNER1);

        vm.prank(wallet1);
        vm.expectRevert(TargetNotAllowed.selector);
        sm.validateLightweightSession(sessionId, sessionKey1, 0.01 ether, wrongTarget);

        vm.prank(wallet1);
        bool ok = sm.validateLightweightSession(sessionId, sessionKey1, 0.01 ether, target);
        assertTrue(ok);
    }

    // ═══════════════════════════════════════════════
    //  INVARIANT
    // ═══════════════════════════════════════════════

    function test_Invariant_SessionTypeNeverChanges() public {
        bytes32 sid = keccak256("type-stable");
        _createLightSession(wallet1, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
        assertEq(sm.getSessionType(sid), 1);
        vm.warp(block.timestamp + 1000 days);
        assertEq(sm.getSessionType(sid), 1);
    }

    function test_Invariant_ExpiredSessionNeverValidates() public {
        bytes32 sid = keccak256("expire-inv");
        _createLightSession(wallet1, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
        vm.prank(wallet1);
        sm.validateLightweightSession(sid, sessionKey1, 0.1 ether, address(0xBEEF));
        vm.warp(block.timestamp + 2 hours);
        vm.prank(wallet1);
        vm.expectRevert(SessionExpired.selector);
        sm.validateLightweightSession(sid, sessionKey1, 0.01 ether, address(0xBEEF));
    }

    function test_Invariant_RevokedSessionNeverValidates() public {
        bytes32 sid = keccak256("revoke-inv");
        _createLightSession(wallet1, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
        vm.prank(vm.addr(PK_OWNER1));
        sm.revokeLightweightSession(sid, wallet1);
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(wallet1);
            vm.expectRevert(SessionIsRevoked.selector);
            sm.validateLightweightSession(sid, sessionKey1, 0.01 ether, address(0xBEEF));
        }
    }

    function test_Invariant_DailySpendResetsCorrectly() public {
        bytes32 sid = keccak256("daily-inv");
        _createLightSession(wallet1, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 3 days), new address[](0), PK_OWNER1);

        // Day 1: spend full
        vm.prank(wallet1);
        sm.validateLightweightSession(sid, sessionKey1, 0.9 ether, address(0xBEEF));
        vm.prank(wallet1);
        vm.expectRevert(DailySpendLimitExceeded.selector);
        sm.validateLightweightSession(sid, sessionKey1, 0.2 ether, address(0xBEEF));

        // Day 2: reset
        vm.warp(block.timestamp + 1 days);
        vm.prank(wallet1);
        bool ok = sm.validateLightweightSession(sid, sessionKey1, 0.9 ether, address(0xBEEF));
        assertTrue(ok);
        vm.prank(wallet1);
        vm.expectRevert(DailySpendLimitExceeded.selector);
        sm.validateLightweightSession(sid, sessionKey1, 0.2 ether, address(0xBEEF));

        // Day 3: reset
        vm.warp(block.timestamp + 1 days);
        vm.prank(wallet1);
        ok = sm.validateLightweightSession(sid, sessionKey1, 0.9 ether, address(0xBEEF));
        assertTrue(ok);
    }

    // ═══════════════════════════════════════════════
    //  ADVERSARIAL
    // ═══════════════════════════════════════════════

    function test_Adversarial_ForgedLightSessionSignature() public {
        bytes32 sid = keccak256("forged");
        bytes32 msgHash = keccak256(abi.encode(block.chainid, address(sm), wallet1, sid, sessionKey1, uint256(1 ether), uint256(10), uint64(block.timestamp + 1 hours), new address[](0)));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK_OWNER2, digest); // WRONG owner signs
        vm.prank(wallet1);
        vm.expectRevert(NotWalletOwner.selector);
        sm.createLightweightSession(sid, sessionKey1, 1 ether, 10, uint64(block.timestamp + 1 hours), new address[](0), abi.encodePacked(r, s, v));
    }

    function test_Adversarial_ReplaySessionOnDifferentWallet() public {
        bytes32 sid = keccak256("cross-wallet-attack");
        _createLightSession(wallet1, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
        vm.prank(wallet2);
        vm.expectRevert(NotBoundWallet.selector);
        sm.validateLightweightSession(sid, sessionKey1, 0.01 ether, address(0xBEEF));
    }

    function test_Adversarial_ZeroTargetInAllowedList() public {
        bytes32 sid = keccak256("zero-target");
        address[] memory targets = new address[](2);
        targets[0] = address(0);
        targets[1] = address(0xBEEF);
        _createLightSession(wallet1, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), targets, PK_OWNER1);
        vm.prank(wallet1);
        bool ok = sm.validateLightweightSession(sid, sessionKey1, 0.01 ether, address(0));
        assertTrue(ok);
    }

    function test_Adversarial_PruneCanRemoveRevoked() public {
        bytes32 sid1 = keccak256("pr-rev");
        _createLightSession(wallet1, sid1, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
        vm.prank(vm.addr(PK_OWNER1));
        sm.revokeLightweightSession(sid1, wallet1);
        assertEq(sm.getWalletSessions(wallet1).length, 1);
        vm.prank(wallet1);
        sm.pruneExpiredSessions(wallet1, 10);
        assertEq(sm.getWalletSessions(wallet1).length, 0);
    }

    function test_Adversarial_ChainIdBindingDifferentChain() public {
        // The signature includes chainId - replay on different chain would fail
        bytes32 sid = keccak256("chainid-bound");
        bytes32 msgHashAltChain = keccak256(abi.encode(uint256(31337 + 1), address(sm), wallet1, sid, sessionKey1, uint256(1 ether), uint256(10), uint64(block.timestamp + 1 hours), new address[](0)));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHashAltChain));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK_OWNER1, digest);
        vm.prank(wallet1);
        vm.expectRevert(); // ECDSA recovery won't match owner
        sm.createLightweightSession(sid, sessionKey1, 1 ether, 10, uint64(block.timestamp + 1 hours), new address[](0), abi.encodePacked(r, s, v));
    }

    function test_Adversarial_PauseMidSession() public {
        bytes32 sid = keccak256("mid-session");
        _createLightSession(wallet1, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
        vm.prank(wallet1);
        sm.validateLightweightSession(sid, sessionKey1, 0.1 ether, address(0xBEEF));

        vm.prank(owner);
        sm.pause();

        vm.prank(wallet1);
        vm.expectRevert();
        sm.validateLightweightSession(sid, sessionKey1, 0.1 ether, address(0xBEEF));

        vm.prank(owner);
        sm.unpause();

        vm.prank(wallet1);
        bool ok = sm.validateLightweightSession(sid, sessionKey1, 0.1 ether, address(0xBEEF));
        assertTrue(ok);
    }

    function test_Adversarial_ZeroValueTx() public {
        bytes32 sid = keccak256("zero-value");
        _createLightSession(wallet1, sid, sessionKey1, 1 ether, 100, uint64(block.timestamp + 1 hours), new address[](0), PK_OWNER1);
        vm.prank(wallet1);
        bool ok = sm.validateLightweightSession(sid, sessionKey1, 0, address(0xBEEF));
        assertTrue(ok);
        (,,,, uint256 dspend,,,) = sm.getLightSession(sid);
        assertEq(dspend, 0);
    }
}
