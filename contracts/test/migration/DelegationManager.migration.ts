import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Migration — DelegationManager V1 → V2", function () {
  let delMgr: any;
  let owner: SignerWithAddress;
  let signers: SignerWithAddress[];

  beforeEach(async function () {
    [owner, ...signers] = await ethers.getSigners();

    const V1Impl = await ethers.getContractFactory("DelegationManager");
    const v1Impl = await V1Impl.deploy();
    const Proxy = await ethers.getContractFactory("ERC1967Proxy");
    const proxy = await Proxy.deploy(
      await v1Impl.getAddress(),
      v1Impl.interface.encodeFunctionData("initialize", [owner.address])
    );
    delMgr = await ethers.getContractAt("DelegationManager", await proxy.getAddress());

    // Populate V1 state
    await delMgr.registerScope("test-scope");
    const scopeHash = ethers.keccak256(ethers.toUtf8Bytes("test-scope"));
    await delMgr.updateDelegationRoot(owner.address, scopeHash, ethers.keccak256(ethers.toUtf8Bytes("root")), 0);
  });

  it("Should preserve delegation state after upgrade", async function () {
    const V2Impl = await ethers.getContractFactory("MockV2_DelegationManager");
    const v2Impl = await V2Impl.deploy();
    await delMgr.upgradeToAndCall(await v2Impl.getAddress(), "0x");

    expect(await delMgr.hasRole(await delMgr.DEFAULT_ADMIN_ROLE(), owner.address)).to.be.true;
    const scopeHash = ethers.keccak256(ethers.toUtf8Bytes("test-scope"));
    const rootInfo = await delMgr.getDelegationRoot(owner.address, scopeHash);
    expect(rootInfo.root).to.equal(ethers.keccak256(ethers.toUtf8Bytes("root")));
  });

  it("Should preserve revoked delegators after upgrade", async function () {
    await delMgr.emergencyRevokeAll(signers[1].address);
    expect(await delMgr.revokedDelegators(signers[1].address)).to.be.true;

    const V2Impl = await ethers.getContractFactory("MockV2_DelegationManager");
    const v2Impl = await V2Impl.deploy();
    await delMgr.upgradeToAndCall(await v2Impl.getAddress(), "0x");

    expect(await delMgr.revokedDelegators(signers[1].address)).to.be.true;
  });

  it("Non-admin cannot upgrade", async function () {
    const V2Impl = await ethers.getContractFactory("MockV2_DelegationManager");
    const v2Impl = await V2Impl.deploy();
    await expect(
      delMgr.connect(signers[1]).upgradeToAndCall(await v2Impl.getAddress(), "0x")
    ).to.be.reverted;
  });
});
