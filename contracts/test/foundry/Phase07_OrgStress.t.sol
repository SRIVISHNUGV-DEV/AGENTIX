// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./utils/AuditHarness.sol";

contract Phase07_OrgStress is AuditHarness {
    address internal orgReg;

    function setUp() public override {
        super.setUp();
        orgReg = _deployProxy("OrganizationRegistry", abi.encodeWithSignature("initialize(address,address)", deployer, makeAddr("anchorImpl")));
    }

    function _registerOrg(bytes32 orgId, string memory name, address owner_) internal {
        vm.prank(deployer);
        orgReg.call(abi.encodeWithSignature("registerOrganization(bytes32,string,address)", orgId, name, owner_));
    }

    function _isActive(bytes32 orgId) internal view returns (bool) {
        (bool ok, bytes memory ret) = orgReg.staticcall(abi.encodeWithSignature("isActive(bytes32)", orgId));
        require(ok);
        return abi.decode(ret, (bool));
    }

    function test_MultipleOrgs_IndependentState() public {
        _registerOrg(keccak256("org1"), "Org1", owner1);
        _registerOrg(keccak256("org2"), "Org2", owner2);
        assertTrue(_isActive(keccak256("org1")));
        assertTrue(_isActive(keccak256("org2")));
        vm.prank(deployer);
        orgReg.call(abi.encodeWithSignature("deactivateOrganization(bytes32)", keccak256("org1")));
        assertFalse(_isActive(keccak256("org1")));
        assertTrue(_isActive(keccak256("org2")));
    }

    function test_OrgDeactivateAndReactivate() public {
        bytes32 orgId = keccak256("toggle-org");
        _registerOrg(orgId, "ToggleOrg", owner1);
        vm.prank(deployer);
        orgReg.call(abi.encodeWithSignature("deactivateOrganization(bytes32)", orgId));
        assertFalse(_isActive(orgId));
        vm.prank(deployer);
        orgReg.call(abi.encodeWithSignature("reactivateOrganization(bytes32)", orgId));
        assertTrue(_isActive(orgId));
    }

    function test_DuplicateOrgId_Reverts() public {
        _registerOrg(keccak256("dup-org"), "Dup", owner1);
        vm.prank(deployer);
        (bool ok,) = orgReg.call(abi.encodeWithSignature("registerOrganization(bytes32,string,address)", keccak256("dup-org"), "Dup2", owner2));
        assertFalse(ok);
    }

    function test_NonOwner_CannotRegisterOrg() public {
        vm.prank(attacker);
        (bool ok,) = orgReg.call(abi.encodeWithSignature("registerOrganization(bytes32,string,address)", keccak256("att-org"), "Att", attacker));
        assertFalse(ok);
    }

    function test_10Orgs_IndependentLifecycle() public {
        for (uint256 i = 0; i < 10; i++) {
            _registerOrg(keccak256(abi.encode("org", i)), "Org", owner1);
        }
        for (uint256 i = 0; i < 10; i++) {
            assertTrue(_isActive(keccak256(abi.encode("org", i))));
        }
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(deployer);
            orgReg.call(abi.encodeWithSignature("deactivateOrganization(bytes32)", keccak256(abi.encode("org", i))));
            assertFalse(_isActive(keccak256(abi.encode("org", i))));
        }
        for (uint256 i = 5; i < 10; i++) {
            assertTrue(_isActive(keccak256(abi.encode("org", i))));
        }
    }
}
