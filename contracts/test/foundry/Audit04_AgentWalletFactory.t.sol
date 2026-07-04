// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../src/AgentWalletFactory.sol";
import "../../src/AgentWallet.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract Audit04_AgentWalletFactory is Test {
    AgentWalletFactory internal factory;
    AgentWallet internal walletImpl;
    address internal owner;
    address internal walletOwner1;
    address internal walletOwner2;
    address internal attacker;
    address internal sm;
    address internal ep;

    event WalletCreated(address indexed wallet, address indexed owner, bytes32 indexed salt, address entryPoint);

    function setUp() public {
        owner = makeAddr("owner");
        walletOwner1 = makeAddr("walletOwner1");
        walletOwner2 = makeAddr("walletOwner2");
        attacker = makeAddr("attacker");
        sm = makeAddr("sessionManager");
        ep = makeAddr("entryPoint");

        walletImpl = new AgentWallet();

        address fImpl = address(new AgentWalletFactory());
        factory = AgentWalletFactory(address(new ERC1967Proxy(fImpl, abi.encodeWithSignature("initialize(address,address,address)", address(walletImpl), sm, ep))));
    }

    // ═══════════════════════════════════════════════
    //  UNIT: Initialization
    // ═══════════════════════════════════════════════

    function test_CannotReinitialize() public {
        vm.expectRevert();
        factory.initialize(address(walletImpl), sm, ep);
    }

    function test_Initialize_SetsParams() public {
        assertEq(factory.implementation(), address(walletImpl));
        assertEq(factory.sessionManager(), sm);
        assertEq(factory.entryPoint(), ep);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: createWallet
    // ═══════════════════════════════════════════════

    function test_CreateWallet_Works() public {
        bytes32 salt = keccak256("test-salt");
        address predicted = factory.getAddress(salt);
        assertTrue(predicted != address(0));

        vm.expectEmit(true, true, true, true);
        emit WalletCreated(predicted, walletOwner1, salt, ep);
        address wallet = factory.createWallet(walletOwner1, salt);

        assertEq(wallet, predicted);
        assertTrue(factory.isAgentWallet(wallet));
        assertEq(AgentWallet(payable(wallet)).owner(), walletOwner1);
        assertEq(AgentWallet(payable(wallet)).sessionManager(), sm);
        assertEq(AgentWallet(payable(wallet)).entryPoint(), ep);
    }

    function test_CreateWallet_AutoSalt() public {
        address wallet = factory.createWallet(walletOwner1);
        assertTrue(factory.isAgentWallet(wallet));
        assertEq(AgentWallet(payable(wallet)).owner(), walletOwner1);
    }

    function test_CreateWallet_Idempotent() public {
        bytes32 salt = keccak256("idempotent");
        address w1 = factory.createWallet(walletOwner1, salt);
        address w2 = factory.createWallet(walletOwner1, salt);
        assertEq(w1, w2);
        assertTrue(factory.isAgentWallet(w1));
    }

    function test_CreateWallet_DifferentOwnerSameSaltReverts() public {
        bytes32 salt = keccak256("collision");
        factory.createWallet(walletOwner1, salt);
        vm.expectRevert(WalletAlreadyExistsWithDifferentOwner.selector);
        factory.createWallet(walletOwner2, salt);
    }

    function test_CreateWallet_ZeroOwner() public {
        vm.expectRevert(FactoryInvalidOwnerError.selector);
        factory.createWallet(address(0));
    }

    function test_CreateWallet_PredictableAddress() public {
        bytes32 salt = keccak256("predictable");
        address predicted = factory.getAddress(salt);
        address wallet = factory.createWallet(walletOwner1, salt);
        assertEq(wallet, predicted);
    }

    function test_CreateWallet_MultipleWallets() public {
        address w1 = factory.createWallet(walletOwner1);
        address w2 = factory.createWallet(walletOwner2);
        assertTrue(w1 != w2);
        assertTrue(factory.isAgentWallet(w1));
        assertTrue(factory.isAgentWallet(w2));
        assertEq(AgentWallet(payable(w1)).owner(), walletOwner1);
        assertEq(AgentWallet(payable(w2)).owner(), walletOwner2);
    }

    function test_CreateWallet_WalletCountIncrements() public {
        assertEq(factory.walletCount(), 0);
        factory.createWallet(walletOwner1);
        assertEq(factory.walletCount(), 1);
        factory.createWallet(walletOwner2);
        assertEq(factory.walletCount(), 2);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: isAgentWallet
    // ═══════════════════════════════════════════════

    function test_IsAgentWallet_NotWallet() public {
        assertFalse(factory.isAgentWallet(makeAddr("rando")));
    }

    // ═══════════════════════════════════════════════
    //  UNIT: getAddress
    // ═══════════════════════════════════════════════

    function test_GetAddress_Deterministic() public {
        bytes32 salt = keccak256("deterministic");
        address a1 = factory.getAddress(salt);
        address a2 = factory.getAddress(salt);
        assertEq(a1, a2);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: setAgentIdentity
    // ═══════════════════════════════════════════════

    function test_SetAgentIdentity_OnlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        factory.setAgentIdentity(makeAddr("identity"));
    }

    function test_SetAgentIdentity_Works() public {
        address id = makeAddr("identity");
        vm.prank(owner);
        factory.setAgentIdentity(id);
        assertEq(factory.agentIdentity(), id);
    }

    function test_SetAgentIdentity_ZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(InvalidAgentIdentityError.selector);
        factory.setAgentIdentity(address(0));
    }

    // ═══════════════════════════════════════════════
    //  UNIT: Timelocks (Implementation)
    // ═══════════════════════════════════════════════

    function test_ProposeImplementation_OnlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        factory.proposeImplementation(makeAddr("impl"));
    }

    function test_ProposeImplementation_TimelockActive() public {
        vm.prank(owner);
        factory.proposeImplementation(makeAddr("impl1"));
        vm.prank(owner);
        vm.expectRevert(FactoryTimelockActiveError.selector);
        factory.proposeImplementation(makeAddr("impl2"));
    }

    function test_AcceptImplementation_BeforeTimelock() public {
        vm.prank(owner);
        factory.proposeImplementation(makeAddr("impl"));
        vm.prank(owner);
        vm.expectRevert(FactoryTimelockNotReadyError.selector);
        factory.acceptImplementation();
    }

    function test_AcceptImplementation_AfterTimelock() public {
        address newImpl = makeAddr("newImpl");
        vm.prank(owner);
        factory.proposeImplementation(newImpl);
        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(owner);
        factory.acceptImplementation();
        assertEq(factory.implementation(), newImpl);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: Timelocks (SessionManager)
    // ═══════════════════════════════════════════════

    function test_ProposeFactory_SessionManager_Timelock() public {
        address newSM = makeAddr("newSM");
        vm.prank(owner);
        factory.proposeSessionManager(newSM);
        assertEq(factory.pendingSessionManager(), newSM);
    }

    function test_AcceptFactory_SessionManager_AfterTimelock() public {
        address newSM = makeAddr("newSM");
        vm.prank(owner);
        factory.proposeSessionManager(newSM);
        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(owner);
        factory.acceptSessionManager();
        assertEq(factory.sessionManager(), newSM);
    }

    // ═══════════════════════════════════════════════
    //  UNIT: Timelocks (EntryPoint)
    // ═══════════════════════════════════════════════

    function test_ProposeFactory_EntryPoint_Timelock() public {
        address newEP = makeAddr("newEP");
        vm.prank(owner);
        factory.proposeEntryPoint(newEP);
        assertEq(factory.pendingEntryPoint(), newEP);
    }

    function test_AcceptFactory_EntryPoint_AfterTimelock() public {
        address newEP = makeAddr("newEP");
        vm.prank(owner);
        factory.proposeEntryPoint(newEP);
        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(owner);
        factory.acceptEntryPoint();
        assertEq(factory.entryPoint(), newEP);
    }

    // ═══════════════════════════════════════════════
    //  FUZZ
    // ═══════════════════════════════════════════════

    function testFuzz_CreateWallet_Deterministic(bytes32 salt) public {
        address predicted = factory.getAddress(salt);
        address wallet = factory.createWallet(walletOwner1, salt);
        assertEq(wallet, predicted);
    }

    function testFuzz_MultipleWalletOwners(address _owner) public {
        vm.assume(_owner != address(0));
        vm.assume(_owner != walletOwner1);
        address w = factory.createWallet(_owner);
        assertEq(AgentWallet(payable(w)).owner(), _owner);
    }

    // ═══════════════════════════════════════════════
    //  INVARIANT
    // ═══════════════════════════════════════════════

    function test_Invariant_FactoryCreatesUniqueWallets() public {
        for (uint256 i = 0; i < 20; i++) {
            address w = factory.createWallet(walletOwner1);
            assertTrue(factory.isAgentWallet(w));
            assertEq(AgentWallet(payable(w)).owner(), walletOwner1);
        }
    }

    function test_Invariant_CreatedWalletOwnershipUnchanged() public {
        address w = factory.createWallet(walletOwner1);
        vm.warp(block.timestamp + 1000 days);
        assertEq(AgentWallet(payable(w)).owner(), walletOwner1);
    }

    // ═══════════════════════════════════════════════
    //  ADVERSARIAL
    // ═══════════════════════════════════════════════

    function test_Adversarial_FrontrunSalt() public {
        // Attacker cannot frontrun because we pass owner in salt
        bytes32 salt = keccak256("frontrunner");
        address predicted = factory.getAddress(salt);
        // Deployer with different owner would collide
        factory.createWallet(walletOwner1, salt);
        vm.expectRevert(WalletAlreadyExistsWithDifferentOwner.selector);
        factory.createWallet(walletOwner2, salt);
    }

    function test_Adversarial_NonOwnerCannotSetIdentity() public {
        vm.prank(attacker);
        vm.expectRevert();
        factory.setAgentIdentity(makeAddr("id"));
    }

    function test_Adversarial_FactoryImplementationLocked() public {
        address fImpl = address(new AgentWalletFactory());
        vm.expectRevert();
        AgentWalletFactory(fImpl).initialize(makeAddr("impl"), makeAddr("sm"), makeAddr("ep"));
    }
}
