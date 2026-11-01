import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/// @notice C-3 + C-7 (delegation side) regression tests.
///         C-3: revokeDelegation must not be a global kill-switch. Revocations are namespaced
///         per delegator, so a self-registered attacker revoking a victim's leaf only poisons
///         their OWN namespace and the victim's verification keeps passing.
///         C-7: revokeDelegation and emergencyRevokeAll work while paused.
describe("DelegationRevokeGuard (C-3, C-7)", function () {
  let delegationManager: any;
  let owner: SignerWithAddress;
  let victimDelegator: SignerWithAddress;
  let victimDelegate: SignerWithAddress;
  let attacker: SignerWithAddress;
  let rootUpdater: SignerWithAddress;

  const scopeHash = ethers.id("transfer_assets");

  /// Sets a delegation root via the 2-day timelock (C-5).
  async function setRoot(delegator: string, scope: string, root: string, expiry: number) {
    await delegationManager.proposeDelegationRoot(delegator, scope, root, expiry);
    await ethers.provider.send("evm_increaseTime", [172800]);
    await ethers.provider.send("evm_mine", []);
    await delegationManager.acceptDelegationRoot(delegator, scope);
  }

  function leafFor(delegator: string, delegate: string, scope: string, expiry: number) {
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "bytes32", "uint64"],
        [delegator, delegate, scope, expiry]
      )
    );
  }

  beforeEach(async function () {
    [owner, victimDelegator, victimDelegate, attacker, rootUpdater] = await ethers.getSigners();
    const DelMgrImpl = await ethers.getContractFactory("DelegationManager");
    const delMgrImpl = await DelMgrImpl.deploy();
    const DelMgrProxy = await ethers.getContractFactory("ERC1967Proxy");
    const delMgrProxy = await DelMgrProxy.deploy(
      await delMgrImpl.getAddress(),
      delMgrImpl.interface.encodeFunctionData("initialize", [owner.address])
    );
    delegationManager = await ethers.getContractAt("DelegationManager", await delMgrProxy.getAddress());
    await delegationManager.setRootUpdater(rootUpdater.address, true);
  });

  it("C-3: attacker revoking the victim leaf does NOT break victim verification", async function () {
    // Victim tree: single-leaf tree, root == leaf, empty proof verifies.
    const leaf = leafFor(victimDelegator.address, victimDelegate.address, scopeHash, 0);
    await setRoot(victimDelegator.address, scopeHash, leaf, 0);
    const before = await delegationManager.connect(victimDelegate).verifyDelegation.staticCall(
      leaf, [], victimDelegator.address, scopeHash, 0, 10
    );
    expect(before).to.equal(true);

    // Attacker self-registers, then "revokes" the victim leaf under their own name.
    await delegationManager.connect(attacker).proposeDelegationRoot(
      attacker.address, scopeHash, ethers.id("attacker-root"), 0
    );
    await ethers.provider.send("evm_increaseTime", [172800]);
    await ethers.provider.send("evm_mine", []);
    await delegationManager.connect(attacker).acceptDelegationRoot(attacker.address, scopeHash);
    await delegationManager.connect(attacker).revokeDelegation(leaf, attacker.address);
    expect(await delegationManager.isRevoked(attacker.address, leaf)).to.equal(true);

    // Victim verification is unaffected: the revocation lives in the attacker's namespace.
    const after = await delegationManager.connect(victimDelegate).verifyDelegation.staticCall(
      leaf, [], victimDelegator.address, scopeHash, 0, 10
    );
    expect(after).to.equal(true);
    expect(await delegationManager.isRevoked(victimDelegator.address, leaf)).to.equal(false);
  });

  it("C-3: delegator revoking their own leaf DOES break their verification", async function () {
    const leaf = leafFor(victimDelegator.address, victimDelegate.address, scopeHash, 0);
    await setRoot(victimDelegator.address, scopeHash, leaf, 0);
    await delegationManager.connect(victimDelegator).revokeDelegation(leaf, victimDelegator.address);
    const valid = await delegationManager.connect(victimDelegate).verifyDelegation.staticCall(
      leaf, [], victimDelegator.address, scopeHash, 0, 10
    );
    expect(valid).to.equal(false);
  });

  it("C-3: root updater CAN revoke in a delegator tree; strangers CANNOT", async function () {
    const leaf = leafFor(victimDelegator.address, victimDelegate.address, scopeHash, 0);
    await setRoot(victimDelegator.address, scopeHash, leaf, 0);
    await delegationManager.connect(rootUpdater).revokeDelegation(leaf, victimDelegator.address);
    expect(await delegationManager.isRevoked(victimDelegator.address, leaf)).to.equal(true);

    const leaf2 = leafFor(victimDelegator.address, victimDelegate.address, scopeHash, 1);
    await expect(
      delegationManager.connect(attacker).revokeDelegation(leaf2, victimDelegator.address)
    ).to.be.revertedWithCustomError(delegationManager, "AccessControlUnauthorizedAccount");
  });

  it("C-7: revokeDelegation and emergencyRevokeAll work WHILE PAUSED", async function () {
    const leaf = leafFor(victimDelegator.address, victimDelegate.address, scopeHash, 0);
    await setRoot(victimDelegator.address, scopeHash, leaf, 0);
    await delegationManager.pause();
    await delegationManager.connect(victimDelegator).revokeDelegation(leaf, victimDelegator.address);
    expect(await delegationManager.isRevoked(victimDelegator.address, leaf)).to.equal(true);
    await delegationManager.emergencyRevokeAll(victimDelegator.address);
    expect(await delegationManager.revokedDelegators(victimDelegator.address)).to.equal(true);
  });
});
