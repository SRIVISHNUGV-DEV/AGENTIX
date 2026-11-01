import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/// @notice C-5 regression tests: all root changes are timelocked (2 days).
///         Propose -> warp 2 days -> accept; cancel clears the pending root.
///         Covers CredentialRegistry, OrganizationCredentialAnchor, and
///         DelegationManager. A test that proposes and accepts without the
///         warp MUST revert with TimelockNotReady — that is the point.
describe("RootTimelock (C-5)", function () {
  let registry: any;
  let anchor: any;
  let delegationManager: any;
  let owner: SignerWithAddress;
  let issuer: SignerWithAddress;
  let attacker: SignerWithAddress;
  let delegator: SignerWithAddress;
  let rootUpdater: SignerWithAddress;

  const ORG_ID = ethers.id("timelock-org");
  const SCOPE = ethers.id("timelock-scope");

  async function warp2d() {
    await ethers.provider.send("evm_increaseTime", [172800]);
    await ethers.provider.send("evm_mine", []);
  }

  beforeEach(async function () {
    [owner, issuer, attacker, delegator, rootUpdater] = await ethers.getSigners();

    const RegImpl = await ethers.getContractFactory("CredentialRegistry");
    const regImpl = await RegImpl.deploy();
    const RegProxy = await ethers.getContractFactory("ERC1967Proxy");
    const regProxy = await RegProxy.deploy(
      await regImpl.getAddress(),
      regImpl.interface.encodeFunctionData("initialize", [owner.address])
    );
    registry = await ethers.getContractAt("CredentialRegistry", await regProxy.getAddress());
    await registry.addIssuer(issuer.address);

    const AnchorImpl = await ethers.getContractFactory("OrganizationCredentialAnchor");
    const anchorImpl = await AnchorImpl.deploy();
    const AnchorProxy = await ethers.getContractFactory("ERC1967Proxy");
    const anchorProxy = await AnchorProxy.deploy(
      await anchorImpl.getAddress(),
      anchorImpl.interface.encodeFunctionData("initialize", [ORG_ID, owner.address])
    );
    anchor = await ethers.getContractAt("OrganizationCredentialAnchor", await anchorProxy.getAddress());

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

  describe("CredentialRegistry", function () {
    it("C-5: issuer proposes, early accept reverts, accept after 2 days sets root", async function () {
      const root = ethers.keccak256(ethers.toUtf8Bytes("root"));
      await registry.connect(issuer).proposeActiveRoot(root);
      await expect(registry.connect(issuer).acceptActiveRoot()).to.be.revertedWithCustomError(
        registry,
        "TimelockNotReady"
      );
      expect(await registry.activeRoot()).to.equal(ethers.ZeroHash);
      await warp2d();
      await expect(registry.connect(issuer).acceptActiveRoot())
        .to.emit(registry, "ActiveRootUpdated")
        .withArgs(root);
      expect(await registry.activeRoot()).to.equal(root);
    });

    it("C-5: non-issuer cannot propose, zero root reverts, second propose reverts", async function () {
      await expect(
        registry.connect(attacker).proposeActiveRoot(ethers.keccak256(ethers.toUtf8Bytes("x")))
      ).to.be.revertedWithCustomError(registry, "OnlyIssuer");
      await expect(
        registry.connect(issuer).proposeActiveRoot(ethers.ZeroHash)
      ).to.be.revertedWithCustomError(registry, "RootCannotBeZero");
      await registry.connect(issuer).proposeActiveRoot(ethers.keccak256(ethers.toUtf8Bytes("a")));
      await expect(
        registry.connect(issuer).proposeActiveRoot(ethers.keccak256(ethers.toUtf8Bytes("b")))
      ).to.be.revertedWithCustomError(registry, "PendingRootActive");
    });

    it("C-5: issuer cancel clears pending; owner cancel works; stranger cancel reverts", async function () {
      const root = ethers.keccak256(ethers.toUtf8Bytes("root"));
      await registry.connect(issuer).proposeActiveRoot(root);
      await registry.connect(issuer).cancelActiveRoot();
      await expect(registry.connect(issuer).acceptActiveRoot()).to.be.revertedWithCustomError(
        registry,
        "NoPendingRoot"
      );
      // Owner (non-proposing issuer) can cancel a compromised issuer's proposal.
      await registry.connect(issuer).proposeActiveRoot(root);
      await registry.connect(owner).cancelActiveRoot();
      await expect(registry.connect(issuer).acceptActiveRoot()).to.be.revertedWithCustomError(
        registry,
        "NoPendingRoot"
      );
      // Stranger cannot cancel.
      await registry.connect(issuer).proposeActiveRoot(root);
      await expect(registry.connect(attacker).cancelActiveRoot()).to.be.revertedWithCustomError(
        registry,
        "NotIssuerOrOwner"
      );
    });

    it("C-5: revoked secret root follows the same propose/warp/accept path", async function () {
      const root = ethers.keccak256(ethers.toUtf8Bytes("revoked"));
      await registry.connect(issuer).proposeRevokedSecretRoot(root);
      await expect(registry.connect(issuer).acceptRevokedSecretRoot()).to.be.revertedWithCustomError(
        registry,
        "TimelockNotReady"
      );
      await warp2d();
      await expect(registry.connect(issuer).acceptRevokedSecretRoot())
        .to.emit(registry, "RevokedSecretRootUpdated")
        .withArgs(root);
      expect(await registry.revokedSecretRoot()).to.equal(root);
    });

    it("C-5: accept with no pending root reverts", async function () {
      await expect(registry.connect(issuer).acceptActiveRoot()).to.be.revertedWithCustomError(
        registry,
        "NoPendingRoot"
      );
    });
  });

  describe("OrganizationCredentialAnchor", function () {
    it("C-5: owner proposes, early accept reverts, accept after 2 days sets root", async function () {
      const root = ethers.keccak256(ethers.toUtf8Bytes("root"));
      await anchor.connect(owner).proposeRoot(root);
      await expect(anchor.connect(owner).acceptRoot()).to.be.revertedWithCustomError(
        anchor,
        "TimelockNotReady"
      );
      await warp2d();
      await expect(anchor.connect(owner).acceptRoot())
        .to.emit(anchor, "RootUpdated")
        .withArgs(ORG_ID, ethers.ZeroHash, root);
      expect(await anchor.currentRoot()).to.equal(root);
    });

    it("C-5: proposing the current root reverts; cancel clears pending", async function () {
      const root = ethers.keccak256(ethers.toUtf8Bytes("root"));
      await anchor.connect(owner).proposeRoot(root);
      await warp2d();
      await anchor.connect(owner).acceptRoot();
      await expect(anchor.connect(owner).proposeRoot(root)).to.be.revertedWithCustomError(
        anchor,
        "RootAlreadyCurrent"
      );
      // Clearing: proposing root 0 is allowed once a root is set.
      const next = ethers.keccak256(ethers.toUtf8Bytes("next"));
      await anchor.connect(owner).proposeRoot(next);
      await anchor.connect(owner).cancelRoot();
      await expect(anchor.connect(owner).acceptRoot()).to.be.revertedWithCustomError(
        anchor,
        "NoPendingRoot"
      );
      expect(await anchor.currentRoot()).to.equal(root);
    });

    it("C-5: non-owner cannot propose or accept", async function () {
      await expect(
        anchor.connect(attacker).proposeRoot(ethers.keccak256(ethers.toUtf8Bytes("x")))
      ).to.be.reverted;
      await anchor.connect(owner).proposeRoot(ethers.keccak256(ethers.toUtf8Bytes("x")));
      await expect(anchor.connect(attacker).acceptRoot()).to.be.reverted;
    });
  });

  describe("DelegationManager", function () {
    it("C-5: delegator proposes, early accept reverts, accept after 2 days sets root", async function () {
      const root = ethers.keccak256(ethers.toUtf8Bytes("root"));
      await delegationManager.connect(delegator).proposeDelegationRoot(delegator.address, SCOPE, root, 0);
      await expect(
        delegationManager.connect(delegator).acceptDelegationRoot(delegator.address, SCOPE)
      ).to.be.revertedWithCustomError(delegationManager, "TimelockNotReady");
      await warp2d();
      await expect(
        delegationManager.connect(delegator).acceptDelegationRoot(delegator.address, SCOPE)
      )
        .to.emit(delegationManager, "DelegationRootUpdated")
        .withArgs(delegator.address, SCOPE, root, 0);
      const info = await delegationManager.getDelegationRoot(delegator.address, SCOPE);
      expect(info.root).to.equal(root);
    });

    it("C-5: root updater can propose/accept for another delegator; stranger cannot", async function () {
      const root = ethers.keccak256(ethers.toUtf8Bytes("root"));
      await expect(
        delegationManager.connect(attacker).proposeDelegationRoot(delegator.address, SCOPE, root, 0)
      ).to.be.reverted;
      await delegationManager.connect(rootUpdater).proposeDelegationRoot(delegator.address, SCOPE, root, 0);
      await warp2d();
      await delegationManager.connect(rootUpdater).acceptDelegationRoot(delegator.address, SCOPE);
      expect((await delegationManager.getDelegationRoot(delegator.address, SCOPE)).root).to.equal(root);
    });

    it("C-5: cancel by delegator clears pending; admin can also cancel", async function () {
      const root = ethers.keccak256(ethers.toUtf8Bytes("root"));
      await delegationManager.connect(delegator).proposeDelegationRoot(delegator.address, SCOPE, root, 0);
      await delegationManager.connect(delegator).cancelDelegationRoot(delegator.address, SCOPE);
      await expect(
        delegationManager.connect(delegator).acceptDelegationRoot(delegator.address, SCOPE)
      ).to.be.revertedWithCustomError(delegationManager, "NoPendingRoot");
      await delegationManager.connect(delegator).proposeDelegationRoot(delegator.address, SCOPE, root, 0);
      await delegationManager.connect(owner).cancelDelegationRoot(delegator.address, SCOPE);
      await expect(
        delegationManager.connect(delegator).acceptDelegationRoot(delegator.address, SCOPE)
      ).to.be.revertedWithCustomError(delegationManager, "NoPendingRoot");
    });

    it("C-5: accept after emergency revoke reverts (revoked delegator cannot land a pending root)", async function () {
      const root = ethers.keccak256(ethers.toUtf8Bytes("root"));
      await delegationManager.connect(delegator).proposeDelegationRoot(delegator.address, SCOPE, root, 0);
      await warp2d();
      await delegationManager.emergencyRevokeAll(delegator.address);
      await expect(
        delegationManager.connect(delegator).acceptDelegationRoot(delegator.address, SCOPE)
      ).to.be.revertedWithCustomError(delegationManager, "DelegatorHasBeenRevoked");
    });
  });
});
