// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../../src/AgentWallet.sol";
import "../../../src/mocks/MockVerifier.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract MockEntryPoint is IEntryPoint {
    mapping(address => uint256) public override balanceOf;
    function depositTo(address account) external payable override { balanceOf[account] += msg.value; }
    function withdrawTo(address payable withdrawAddress, uint256 amount) external override {
        require(balanceOf[msg.sender] >= amount);
        balanceOf[msg.sender] -= amount;
        (bool ok,) = withdrawAddress.call{value: amount}("");
        require(ok);
    }
    function validateUserOp(PackedUserOperation calldata userOp, bytes32, uint256) external returns (uint256) {
        return AgentWallet(payable(userOp.sender)).validateUserOp(userOp, keccak256("test"), 0);
    }
}

contract AuditHarness is Test {
    AgentWallet internal walletImpl;
    MockVerifier internal verifier;
    MockEntryPoint internal ep;

    address internal credReg;
    address internal sm;
    address internal factory;
    address internal identity;

    uint256 internal constant PK_DEPLOYER = 0xA11CE;
    uint256 internal constant PK_OWNER1 = 0xB0B;
    uint256 internal constant PK_OWNER2 = 0xC01;
    uint256 internal constant PK_SESSION_KEY1 = 0xDAD;
    uint256 internal constant PK_SESSION_KEY2 = 0xFAD;
    uint256 internal constant PK_ATTACKER = 0xBEEF;

    address internal deployer = vm.addr(PK_DEPLOYER);
    address internal owner1 = vm.addr(PK_OWNER1);
    address internal owner2 = vm.addr(PK_OWNER2);
    address internal sessionKey1 = vm.addr(PK_SESSION_KEY1);
    address internal sessionKey2 = vm.addr(PK_SESSION_KEY2);
    address internal attacker = vm.addr(PK_ATTACKER);

    mapping(address => uint256) internal _pk;

    function setUp() public virtual {
        _pk[deployer] = PK_DEPLOYER;
        _pk[owner1] = PK_OWNER1;
        _pk[owner2] = PK_OWNER2;
        _pk[sessionKey1] = PK_SESSION_KEY1;
        _pk[sessionKey2] = PK_SESSION_KEY2;
        _pk[attacker] = PK_ATTACKER;

        vm.startPrank(deployer);
        ep = new MockEntryPoint();
        verifier = new MockVerifier();
        verifier.setResult(true);
        walletImpl = new AgentWallet();

        credReg = _deployProxy("CredentialRegistry", abi.encodeWithSignature("initialize(address)", deployer));
        sm = _deployProxy("SessionManager", abi.encodeWithSignature("initialize(address,address,address)", address(verifier), credReg, address(1)));
        factory = _deployProxy("AgentWalletFactory", abi.encodeWithSignature("initialize(address,address,address)", address(walletImpl), sm, address(ep)));

        (bool ok1,) = sm.call(abi.encodeWithSignature("proposeWalletFactory(address)", factory));
        require(ok1);
        vm.warp(block.timestamp + 24 hours + 1);
        (bool ok2,) = sm.call(abi.encodeWithSignature("acceptWalletFactory()"));
        require(ok2);
        vm.warp(block.timestamp - 24 hours - 1);

        (bool ok3,) = credReg.call(abi.encodeWithSignature("setSessionManager(address,bool)", sm, true));
        require(ok3);

        identity = _deployProxy("AgentIdentity", abi.encodeWithSignature("initialize(address,address)", deployer, factory));
        (bool ok4,) = factory.call(abi.encodeWithSignature("setAgentIdentity(address)", identity));
        require(ok4);
        vm.stopPrank();
    }

    function _deployProxy(string memory name, bytes memory init) internal virtual returns (address) {
        bytes memory implCode = vm.getCode(string(abi.encodePacked(name, ".sol:", name)));
        address impl;
        assembly { impl := create(0, add(implCode, 0x20), mload(implCode)) }
        require(impl != address(0), string.concat(name, " impl failed"));

        ERC1967Proxy proxy = new ERC1967Proxy(impl, init);
        return address(proxy);
    }

    function _createWallet(address own) internal returns (address) {
        vm.prank(deployer);
        (bool ok, bytes memory ret) = factory.call(abi.encodeWithSignature("createWallet(address)", own));
        require(ok);
        return abi.decode(ret, (address));
    }

    function _createLightSession(
        address w, bytes32 sid, address sKey, uint256 dSpend, uint256 dTx, uint64 exp, address[] memory tgts
    ) internal {
        address wOwn;
        (, bytes memory ownerRet) = w.staticcall(abi.encodeWithSignature("owner()"));
        wOwn = abi.decode(ownerRet, (address));
        uint256 pk = _pk[wOwn];
        bytes32 msgHash = keccak256(abi.encode(block.chainid, sm, w, sid, sKey, dSpend, dTx, exp, tgts));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);

        vm.prank(w);
        (bool ok,) = sm.call(abi.encodeWithSignature(
            "createLightweightSession(bytes32,address,uint256,uint256,uint64,address[],bytes)",
            sid, sKey, dSpend, dTx, exp, tgts, abi.encodePacked(r, s, v)
        ));
        require(ok);
    }

    function _getSessionType(bytes32 sid) internal view returns (uint8) {
        (bool ok, bytes memory ret) = sm.staticcall(abi.encodeWithSignature("getSessionType(bytes32)", sid));
        require(ok);
        return abi.decode(ret, (uint8));
    }

    function _getLightSession(bytes32 sid) internal view returns (
        address sWallet, address sKey, uint256 dSpendLim, uint256 dTxLim,
        uint256 dSpendUsed, uint256 dTxUsed, uint64 exp, bool revoked
    ) {
        (bool ok, bytes memory ret) = sm.staticcall(abi.encodeWithSignature("getLightSession(bytes32)", sid));
        require(ok);
        return abi.decode(ret, (address, address, uint256, uint256, uint256, uint256, uint64, bool));
    }

    function _smCall(bytes memory data) internal returns (bytes memory) {
        (bool ok, bytes memory ret) = sm.call(data);
        require(ok);
        return ret;
    }

    function _smStaticCall(bytes memory data) internal view returns (bytes memory) {
        (bool ok, bytes memory ret) = sm.staticcall(data);
        require(ok);
        return ret;
    }

    receive() external payable {}
}
